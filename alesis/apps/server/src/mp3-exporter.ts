import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import toneMidi from "@tonejs/midi";
import type { Midi as MidiType } from "@tonejs/midi";
import { NeonPressureSynth, type NeonPressureParameters } from "@alesis/audio";
import { exportNameSchema, type EngineSnapshot, type Take } from "@alesis/protocol";
import type { RecordedMidiEvent } from "./loop-playback.js";

const { Midi } = toneMidi;

export interface ExportRequest {
  name: string;
  snapshot: EngineSnapshot;
  recordings: Map<string, RecordedMidiEvent[]>;
  soundFontPath: string;
  percussionSoundFontPath?: string;
  outputRoot?: string;
}

export interface ExportResult {
  directory: string;
  tracks: string[];
  mix: string;
}

export async function exportMp3Session(request: ExportRequest): Promise<ExportResult> {
  if (request.snapshot.promoted.length === 0) throw new Error("No promoted tracks to export");
  const missing = request.snapshot.promoted.find(({ id }) => !request.recordings.has(id));
  if (missing) throw new Error(`Missing recording for promoted take: ${missing.id}`);
  const name = exportNameSchema.parse(request.name);
  const outputRoot = request.outputRoot ?? join(homedir(), "alesis_recordings");
  const directory = join(outputRoot, name);
  await mkdir(outputRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "alesis-export-"));
  let destinationCreated = false;
  try {
    await mkdir(directory);
    destinationCreated = true;
    const tracks: string[] = [];
    for (const [index, take] of request.snapshot.promoted.entries()) {
      const baseName = `track-${String(index + 1).padStart(2, "0")}`;
      const midiPath = join(temporaryDirectory, `${baseName}.mid`);
      const wavPath = join(temporaryDirectory, `${baseName}.wav`);
      const mp3Path = join(directory, `${baseName}.mp3`);
      const recording = request.recordings.get(take.id)!;
      await writeFile(midiPath, recordingToMidi(recording, take, request.snapshot));
      const percussion = recording.filter(({ event }) => event.channel === 9);
      const melodic = recording.filter(({ event }) => event.channel !== 9);
      if (request.snapshot.synth.selectedId === "subtractive") {
        const neonPath = join(temporaryDirectory, `${baseName}-neon.wav`);
        await writeFile(neonPath, renderNeonWav(recording, take, request.snapshot));
        if (percussion.length > 0 && request.percussionSoundFontPath) {
          const percussionMidiPath = join(temporaryDirectory, `${baseName}-percussion.mid`);
          const percussionPath = join(temporaryDirectory, `${baseName}-percussion.wav`);
          await writeFile(percussionMidiPath, recordingToMidi(percussion, take, request.snapshot));
          await renderSoundFontMidi(percussionMidiPath, percussionPath, request.percussionSoundFontPath, undefined, request.snapshot);
          await mixWav([neonPath, percussionPath], wavPath);
        } else {
          await writeFile(wavPath, await readFile(neonPath));
        }
      } else {
        if (percussion.length > 0 && request.percussionSoundFontPath) {
          const percussionMidiPath = join(temporaryDirectory, `${baseName}-percussion.mid`);
          const percussionPath = join(temporaryDirectory, `${baseName}-percussion.wav`);
          await writeFile(percussionMidiPath, recordingToMidi(percussion, take, request.snapshot));
          await renderSoundFontMidi(percussionMidiPath, percussionPath, request.percussionSoundFontPath, undefined, request.snapshot);
          if (melodic.length > 0) {
            const melodicMidiPath = join(temporaryDirectory, `${baseName}-melodic.mid`);
            const melodicPath = join(temporaryDirectory, `${baseName}-melodic.wav`);
            await writeFile(melodicMidiPath, recordingToMidi(melodic, take, request.snapshot));
            await renderSoundFontMidi(melodicMidiPath, melodicPath, request.soundFontPath, undefined, request.snapshot);
            await mixWav([melodicPath, percussionPath], wavPath);
          } else {
            await writeFile(wavPath, await readFile(percussionPath));
          }
        } else {
          await renderSoundFontMidi(midiPath, wavPath, request.soundFontPath, undefined, request.snapshot);
        }
      }
      await encodeMp3(wavPath, mp3Path);
      tracks.push(mp3Path);
    }
    const mix = join(directory, "mix.mp3");
    await mixMp3(tracks, mix);
    return { directory, tracks, mix };
  } catch (error) {
    if (destinationCreated) await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function renderNeonWav(recording: RecordedMidiEvent[], take: Take, snapshot: EngineSnapshot): Buffer {
  const sampleRate = 48_000;
  const cycleSeconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const frameCount = Math.round(cycleSeconds * sampleRate);
  const synth = new NeonPressureSynth(sampleRate, snapshot.synth.parameterValues as unknown as Partial<NeonPressureParameters>);
  const output = new Float32Array(frameCount * 2);
  let frame = 0;
  for (const { position, event } of [...recording].sort((left, right) => left.position - right.position)) {
    if (event.channel === 9) continue;
    const eventFrame = Math.max(frame, Math.min(frameCount, Math.round(position * frameCount)));
    output.set(synth.render(eventFrame - frame), frame * 2);
    frame = eventFrame;
    synth.dispatchMidi(event.type === "note-on" ? { ...event, velocity: Math.round(event.velocity * take.level) } : event);
  }
  output.set(synth.render(frameCount - frame), frame * 2);
  return encodePcm16Wav(output, sampleRate);
}

export function recordingToMidi(recording: RecordedMidiEvent[], take: Take, snapshot: EngineSnapshot): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(snapshot.settings.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [snapshot.settings.beatsPerMeasure, 4] });
  midi.header.update();
  const cycleSeconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const tracks = new Map<number, ReturnType<MidiType["addTrack"]>>();
  const activeNotes = new Map<string, Array<{ time: number; velocity: number }>>();
  const trackFor = (channel: number) => {
    let track = tracks.get(channel);
    if (!track) {
      track = midi.addTrack();
      track.channel = channel;
      track.name = `Channel ${channel + 1}`;
      if (channel !== 9) {
        track.instrument.number = snapshot.synth.soundFontPresets.find(({ id }) => id === snapshot.synth.selectedSoundFontPresetId)?.program ?? 0;
        const chorusSend = snapshot.synth.parameterValues["chorus-send"] ?? 0;
        const reverbSend = snapshot.synth.parameterValues["reverb-send"] ?? 0;
        track.addCC({ number: 93, value: chorusSend, time: 0 });
        track.addCC({ number: 91, value: reverbSend, time: 0 });
      }
      tracks.set(channel, track);
    }
    return track;
  };

  for (const { position, event } of [...recording].sort((left, right) => left.position - right.position)) {
    const time = Math.max(0, Math.min(cycleSeconds, position * cycleSeconds));
    const track = trackFor(event.channel);
    if (event.type === "note-on" && event.velocity > 0) {
      const key = `${event.channel}:${event.note}`;
      const starts = activeNotes.get(key) ?? [];
      starts.push({ time, velocity: event.velocity / 127 * take.level });
      activeNotes.set(key, starts);
    } else if (event.type === "note-off" || event.type === "note-on" && event.velocity === 0) {
      const key = `${event.channel}:${event.note}`;
      const start = activeNotes.get(key)?.shift();
      if (start) track.addNote({ midi: event.note, time: start.time, duration: Math.max(0.01, time - start.time), velocity: Math.min(1, start.velocity) });
    } else if (event.type === "control-change") {
      track.addCC({ number: event.controller, value: event.value / 127, time });
    } else if (event.type === "pitch-bend") {
      track.addPitchBend({ value: Math.max(-8_192, Math.min(8_191, Math.round(event.value * 8_192))), time });
    }
  }
  for (const [key, starts] of activeNotes) {
    const [channelText, noteText] = key.split(":");
    const track = trackFor(Number(channelText));
    for (const start of starts) track.addNote({ midi: Number(noteText), time: start.time, duration: Math.max(0.01, cycleSeconds - start.time), velocity: Math.min(1, start.velocity) });
  }
  return midi.toArray();
}

async function renderSoundFontMidi(midiPath: string, wavPath: string, soundFontPath: string, percussionSoundFontPath: string | undefined, snapshot: EngineSnapshot): Promise<void> {
  const params = snapshot.synth.parameterValues;
  const args = [
    "-ni", "-F", wavPath, "-r", "48000", "-o", "audio.file.format=s16",
    "-o", `synth.gain=${params.gain ?? 0.72}`,
    "-o", `synth.chorus.active=${(params["chorus-send"] ?? 0) > 0 ? 1 : 0}`,
    "-o", "synth.chorus.level=0.3",
    "-o", `synth.chorus.speed=${params["chorus-rate"] ?? 0.3}`,
    "-o", `synth.chorus.depth=${params["chorus-depth"] ?? 8}`,
    "-o", `synth.chorus.nr=${Math.round(params["chorus-voices"] ?? 3)}`,
    "-o", `synth.reverb.active=${(params["reverb-send"] ?? 0) > 0 ? 1 : 0}`,
    "-o", "synth.reverb.level=0.3",
    "-o", `synth.reverb.room-size=${params["reverb-room"] ?? 0.2}`,
    "-o", `synth.reverb.damp=${params["reverb-damping"] ?? 0}`,
    "-o", `synth.reverb.width=${(params["reverb-width"] ?? 0.5) * 100}`,
  ];
  if (percussionSoundFontPath) args.push(percussionSoundFontPath);
  args.push(soundFontPath, midiPath);
  await run("fluidsynth", args);
}

async function encodeMp3(wavPath: string, mp3Path: string): Promise<void> {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", wavPath, "-codec:a", "libmp3lame", "-q:a", "2", mp3Path]);
}

async function mixMp3(inputs: string[], output: string): Promise<void> {
  const args = inputs.flatMap((input) => ["-i", input]);
  args.push("-filter_complex", `amix=inputs=${inputs.length}:duration=longest:normalize=1`, "-codec:a", "libmp3lame", "-q:a", "2", output);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
}

async function mixWav(inputs: string[], output: string): Promise<void> {
  const args = inputs.flatMap((input) => ["-i", input]);
  args.push("-filter_complex", `amix=inputs=${inputs.length}:duration=longest:normalize=0`, "-c:a", "pcm_s16le", output);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    wav.writeInt16LE(Math.round(sample < 0 ? sample * 32_768 : sample * 32_767), 44 + index * 2);
  }
  return wav;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
  });
}
