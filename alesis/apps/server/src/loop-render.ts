import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineSnapshot, Take } from "@alesis/protocol";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { audibleTakes, hasAudibleNote, makeDrumRecording } from "./loop-layers.js";
import { encodeMp3, encodeSamplePcmMp3, mixMp3, mixWavsToCyclePcm, renderTakeWav } from "./midi-render.js";
import { sampleOnsetTrimFrame } from "./sample-onset.js";
import { renderCancellation, runRenderProcess } from "./render-process.js";
import { cycleRenderSchedule } from "./cycle-render-schedule.js";

export interface LoopRecipe {
  snapshot: EngineSnapshot;
  recordings: Map<string, RecordedMidiEvent[]>;
  soundFontPath?: string;
  percussionSoundFontPath?: string;
}
export interface LoopRenderSelection { target: "sample" | "promoted"; startBeat?: number | undefined }
export interface LoopArtifact {
  directory: string;
  tracks: string[];
  mix: string;
  pcm: Buffer;
  encoded: Buffer;
  durationSeconds: number;
  release(): Promise<void>;
}

/** Freezes before yielding. Selection rotates MIDI; it never edits transport/capture origin. */
export async function renderLoopArtifact(recipe: LoopRecipe, selection: LoopRenderSelection, signal: AbortSignal): Promise<LoopArtifact> {
  const frozen = structuredClone(recipe);
  const { snapshot, recordings } = frozen;
  const beats = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const explicit = selection.startBeat !== undefined;
  if (explicit) {
    if (!Number.isInteger(selection.startBeat) || selection.startBeat! < 0 || selection.startBeat! >= beats) throw new Error("Start beat is outside this loop");
    snapshot.capture.loopStart = selection.startBeat! / beats;
  }
  const sample = selection.target === "sample";
  const seconds = 60 / snapshot.settings.bpm * beats;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > (sample ? 30 : 960)) throw new Error(sample ? "Loop sample duration must be greater than zero and at most 30 seconds" : "Loop duration exceeds export limit");
  const frames = Math.round(seconds * 48_000);
  const takes = sample ? audibleTakes(snapshot) : snapshot.promoted;
  if (!sample && takes.length === 0) throw new Error("No promoted tracks to export");
  const layers: Array<{ take: Take; recording: RecordedMidiEvent[] }> = takes.map((take) => {
    const recording = recordings.get(take.id);
    if (!recording) throw new Error(`Missing recording for ${sample ? "audible" : "promoted"} take: ${take.id}`);
    return { take, recording };
  });
  if (sample) {
    const drums = makeDrumRecording(snapshot);
    if (hasAudibleNote(drums, 1)) {
      if (!frozen.percussionSoundFontPath) throw new Error("Drum pattern export requires a percussion SoundFont file");
      layers.push({ take: { id: "loop-drum-pattern", cycle: snapshot.transport.cycle, level: 1, muted: false, waveform: [] }, recording: drums });
    }
    if (layers.every(({ take, recording }) => !hasAudibleNote(recording, take.level))) throw new Error("No audible note material to export");
    for (const { take, recording } of layers) {
      if (hasAudibleNote(recording, take.level, 9) && !frozen.percussionSoundFontPath) throw new Error("Percussion export requires a percussion SoundFont file");
      if (hasAudibleNote(recording, take.level, "non-percussion") && snapshot.synth.selectedId !== "subtractive" && !frozen.soundFontPath) throw new Error("Melodic export requires a SoundFont file for the selected synth");
    }
  }
  signal.throwIfAborted();
  if (frames * 4 * layers.length > 256 * 1024 * 1024) throw new Error("Prepared export exceeds 256 MiB limit");
  const directory = await mkdtemp(join(tmpdir(), "alesis-loop-artifact-"));
  const release = () => rm(directory, { recursive: true, force: true });
  try {
    return await renderCancellation.run(signal, async () => {
      const wavs: string[] = [];
      const tracks: string[] = [];
      let totalBytes = 0;
      for (const [index, { take, recording }] of layers.entries()) {
        signal.throwIfAborted();
        const baseName = `track-${String(index + 1).padStart(2, "0")}`;
        const wav = await renderTakeWav({ ...frozen, recording, take, temporaryDirectory: directory, baseName, ...(sample || explicit ? { cyclePolicy: "include-wrapped-tails" as const } : {}) });
        totalBytes += (await stat(wav)).size;
        if (totalBytes > 256 * 1024 * 1024) throw new Error("Prepared export exceeds 256 MiB limit");
        wavs.push(wav);
        if (!sample) {
          const mp3 = join(directory, `${baseName}.mp3`);
          if (explicit) {
            // Exact cycle, but keep promoted export's stereo and gain policy.
            await runRenderProcess("ffmpeg", ["-nostdin", "-v", "error", "-i", wav, "-af", `apad,atrim=end_sample=${frames},asetpts=N/SR/TB`, "-ar", "48000", "-ac", "2", "-codec:a", "libmp3lame", "-q:a", "2", "-write_xing", "1", mp3]);
          } else await encodeMp3(wav, mp3);
          tracks.push(mp3);
        }
      }
      const mix = join(directory, "mix.mp3");
      if (sample) {
        const raw = join(directory, "cycle.pcm");
        await mixWavsToCyclePcm(wavs, raw, frames);
        const pcm = await readFile(raw);
        if (pcm.length !== frames * 4) throw new Error("Unexpected rendered sample frame count");
        let firstAttackFrame = frames;
        for (const { take, recording } of layers) {
          for (const { position, event } of cycleRenderSchedule(recording, snapshot.capture.loopStart, take.level, seconds).events) {
            if (event.type === "note-on" && event.velocity > 0) firstAttackFrame = Math.min(firstAttackFrame, Math.round(position * frames));
          }
        }
        const onset = sampleOnsetTrimFrame(pcm, firstAttackFrame);
        await encodeSamplePcmMp3(raw, mix, !explicit && snapshot.capture.loopStart === 0 ? onset : 0);
        if ((await stat(mix)).size > 32 * 1024 * 1024) throw new Error("Encoded sample exceeds 32 MiB limit");
      } else await mixMp3(tracks, mix);
      const decoded = join(directory, "preview.pcm");
      await runRenderProcess("ffmpeg", ["-nostdin", "-v", "error", "-i", mix, "-f", "s16le", "-ar", "48000", "-ac", "2", decoded]);
      if ((await stat(decoded)).size > 192 * 1024 * 1024) throw new Error("Decoded preview exceeds 192 MiB limit");
      const pcm = await readFile(decoded);
      if (pcm.length === 0 || pcm.length % 4 !== 0) throw new Error("Invalid decoded preview frames");
      signal.throwIfAborted();
      return { directory, tracks, mix, pcm, encoded: await readFile(mix), durationSeconds: pcm.length / 4 / 48_000, release };
    });
  } catch (error) { await release(); throw error; }
}
