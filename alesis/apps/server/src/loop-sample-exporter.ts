import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { exportNameSchema, type EngineSnapshot, type Take } from "@alesis/protocol";
import { encodeSamplePcmMp3, mixWavsToCyclePcm, renderTakeWav } from "./mp3-exporter.js";
import { sampleOnsetTrimFrame } from "./sample-onset.js";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { drumPatternAtStep } from "./drum-patterns.js";
import { publishLoopSample } from "./loop-sample-sequence.js";

const SAMPLE_RATE = 48_000;
const MAX_DURATION_SECONDS = 30;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export interface ExportLoopSampleRequest {
  name?: string;
  snapshot: EngineSnapshot;
  recordings: Map<string, RecordedMidiEvent[]>;
  sampleRoot: string;
  soundFontPath?: string;
  percussionSoundFontPath?: string;
}

export interface ExportLoopSampleResult {
  filename: string;
  path: string;
  durationSeconds: number;
  warning?: string;
}

export async function exportLoopSample(request: ExportLoopSampleRequest): Promise<ExportLoopSampleResult> {
  // Copy mutable engine state and recordings synchronously before the first filesystem await.
  const snapshot = structuredClone(request.snapshot);
  const takes = audibleTakes(snapshot);
  const sourceRecordings = new Map(takes.flatMap(({ id }) => {
    const recording = request.recordings.get(id);
    return recording ? [[id, structuredClone(recording)] as const] : [];
  }));
  const name = request.name === undefined ? undefined : exportNameSchema.parse(request.name);

  const cycleSeconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  if (!Number.isFinite(cycleSeconds) || cycleSeconds <= 0 || cycleSeconds > MAX_DURATION_SECONDS) {
    throw new Error(`Loop sample duration must be greater than zero and at most ${MAX_DURATION_SECONDS} seconds`);
  }
  const frameCount = Math.round(cycleSeconds * SAMPLE_RATE);
  const layers: Array<{ take: Take; recording: RecordedMidiEvent[] }> = [];
  for (const take of takes) {
    const recording = sourceRecordings.get(take.id);
    if (!recording) throw new Error(`Missing recording for audible take: ${take.id}`);
    layers.push({ take, recording });
  }

  const drumRecording = makeDrumRecording(snapshot);
  if (hasAudibleNote(drumRecording, 1)) {
    if (!request.percussionSoundFontPath) throw new Error("Drum pattern export requires a percussion SoundFont file");
  }
  for (const { take, recording } of layers) {
    if (hasAudibleNote(recording, take.level, 9) && !request.percussionSoundFontPath) {
      throw new Error("Percussion export requires a percussion SoundFont file");
    }
  }
  for (const { take, recording } of layers) {
    if (hasAudibleNote(recording, take.level, "non-percussion") && snapshot.synth.selectedId !== "subtractive" && !request.soundFontPath) {
      throw new Error("Melodic export requires a SoundFont file for the selected synth");
    }
  }
  if (layers.every(({ take, recording }) => !hasAudibleNote(recording, take.level)) && !hasAudibleNote(drumRecording, 1)) {
    throw new Error("No audible note material to export");
  }

  const renderLayers = [...layers];
  if (hasAudibleNote(drumRecording, 1)) {
    renderLayers.push({
      take: { id: "loop-drum-pattern", cycle: snapshot.transport.cycle, level: 1, muted: false, waveform: [] },
      recording: drumRecording,
    });
  }

  await mkdir(request.sampleRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(request.sampleRoot, ".alesis-loop-sample-"));
  let result: ExportLoopSampleResult | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    const wavPaths: string[] = [];
    for (const [index, { take, recording }] of renderLayers.entries()) {
      const wavPath = await renderTakeWav({
        recording,
        take,
        snapshot,
        temporaryDirectory,
        baseName: `layer-${String(index + 1).padStart(2, "0")}`,
        ...(request.soundFontPath ? { soundFontPath: request.soundFontPath } : {}),
        ...(request.percussionSoundFontPath ? { percussionSoundFontPath: request.percussionSoundFontPath } : {}),
      });
      wavPaths.push(wavPath);
    }

    const mixedPcmPath = join(temporaryDirectory, "cycle.pcm");
    await mixWavsToCyclePcm(wavPaths, mixedPcmPath, frameCount);
    const pcm = await readFile(mixedPcmPath);
    if (pcm.length !== frameCount * 4) throw new Error("Unexpected rendered sample frame count");
    const startFrame = sampleOnsetTrimFrame(pcm);
    const durationSeconds = (frameCount - startFrame) / SAMPLE_RATE;
    const stagedMp3Path = join(temporaryDirectory, "sample.part");
    await encodeSamplePcmMp3(mixedPcmPath, stagedMp3Path, startFrame);
    const file = await stat(stagedMp3Path);
    if (file.size > MAX_FILE_BYTES) throw new Error(`Encoded sample exceeds ${MAX_FILE_BYTES} byte limit`);

    const published = await publishLoopSample(stagedMp3Path, request.sampleRoot, name);
    result = { ...published, durationSeconds };
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  try {
    await rm(temporaryDirectory, { recursive: true, force: true });
  } catch {
    try {
      console.warn("Unable to clean up temporary loop sample export directory");
    } catch {
      // Cleanup and logging failures must not replace the export result or its original error.
    }
    if (result) result.warning = "Temporary loop sample cleanup failed";
  }

  if (operationFailed) throw operationError;
  if (!result) throw new Error("Unable to allocate a unique sample filename");
  return result;
}

function audibleTakes(snapshot: EngineSnapshot): Take[] {
  if (snapshot.monitorOnly) return [];
  const takes = [
    ...(snapshot.capture.staged && snapshot.capture.stagedAudible ? [snapshot.capture.staged] : []),
    ...snapshot.promoted.filter((take) => !take.muted),
  ].filter((take) => take.level > 0);
  const unique = new Map<string, Take>();
  for (const take of takes) unique.set(take.id, take);
  return [...unique.values()];
}

export function makeDrumRecording(snapshot: EngineSnapshot): RecordedMidiEvent[] {
  if (!snapshot.drums.enabled || snapshot.drums.volume <= 0) return [];
  const totalSteps = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures * 4;
  const cycleSeconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const events: RecordedMidiEvent[] = [];
  for (let step = 0; step < totalSteps; step += 1) {
    const position = step / totalSteps;
    for (const hit of drumPatternAtStep(snapshot, step)) {
      events.push({ position, event: { type: "note-on", channel: 9, note: hit.note, velocity: hit.velocity } });
      events.push({ position: position + 0.08 / cycleSeconds, event: { type: "note-off", channel: 9, note: hit.note } });
    }
  }
  return events.map(({ position, event }) => ({ position: Math.min(1, position), event }));
}

function hasAudibleNote(recording: readonly RecordedMidiEvent[], level: number, channel?: number | "non-percussion"): boolean {
  return recording.some(({ event }) => event.type === "note-on"
    && event.velocity > 0
    && Math.round(event.velocity * level) > 0
    && (channel === undefined || channel === "non-percussion" && event.channel !== 9 || channel === 9 && event.channel === 9));
}

