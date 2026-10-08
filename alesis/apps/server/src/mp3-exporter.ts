import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { writeMidi, type MidiEvent as FileMidiEvent } from "midi-file";
import { NeonPressureSynth, type NeonPressureParameters } from "@alesis/audio";
import { exportNameSchema, type EngineSnapshot, type Take } from "@alesis/protocol";
import { isMappedDrumPadRelease } from "./sample-pads.js";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { rotateRecording } from "./circular-recording.js";

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
      const mp3Path = join(directory, `${baseName}.mp3`);
      const recording = request.recordings.get(take.id)!;
      await renderTakeWav({ recording, take, snapshot: request.snapshot, temporaryDirectory, baseName, soundFontPath: request.soundFontPath, ...(request.percussionSoundFontPath ? { percussionSoundFontPath: request.percussionSoundFontPath } : {}) });
      const wavPath = join(temporaryDirectory, `${baseName}.wav`);
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

export interface TakeWavRenderRequest {
  recording: RecordedMidiEvent[];
  take: Take;
  snapshot: EngineSnapshot;
  temporaryDirectory: string;
  baseName: string;
  soundFontPath?: string;
  percussionSoundFontPath?: string;
}

export async function renderTakeWav(request: TakeWavRenderRequest): Promise<string> {
  const { recording, take, snapshot, temporaryDirectory, baseName, soundFontPath, percussionSoundFontPath } = request;
  const midiPath = join(temporaryDirectory, `${baseName}.mid`);
  const wavPath = join(temporaryDirectory, `${baseName}.wav`);
  await writeFile(midiPath, (snapshot.synth.selectedId === "soundfont" ? recordingToSoundFontMidi : recordingToMidi)(recording, take, snapshot));
  const percussion = recording.filter(({ event }) => event.channel === 9);
  const melodic = recording.filter(({ event }) => event.channel !== 9);
  if (snapshot.synth.selectedId === "subtractive") {
    const neonPath = join(temporaryDirectory, `${baseName}-neon.wav`);
    await writeFile(neonPath, await renderNeonWav(recording, take, snapshot));
    if (percussion.length > 0 && percussionSoundFontPath) {
      const percussionMidiPath = join(temporaryDirectory, `${baseName}-percussion.mid`);
      const percussionPath = join(temporaryDirectory, `${baseName}-percussion.wav`);
      await writeFile(percussionMidiPath, recordingToSoundFontMidi(percussion, take, snapshot));
      await renderSoundFontMidi(percussionMidiPath, percussionPath, percussionSoundFontPath, undefined, snapshot);
      await mixWav([neonPath, percussionPath], wavPath);
    } else {
      await writeFile(wavPath, await readFile(neonPath));
    }
    return wavPath;
  }
  if (percussion.length > 0 && percussionSoundFontPath) {
    const percussionMidiPath = join(temporaryDirectory, `${baseName}-percussion.mid`);
    const percussionPath = join(temporaryDirectory, `${baseName}-percussion.wav`);
    await writeFile(percussionMidiPath, recordingToSoundFontMidi(percussion, take, snapshot));
    await renderSoundFontMidi(percussionMidiPath, percussionPath, percussionSoundFontPath, undefined, snapshot);
    if (melodic.length > 0) {
      if (!soundFontPath) throw new Error("Melodic SoundFont export requires a SoundFont file");
      const melodicMidiPath = join(temporaryDirectory, `${baseName}-melodic.mid`);
      const melodicPath = join(temporaryDirectory, `${baseName}-melodic.wav`);
      await writeFile(melodicMidiPath, recordingToSoundFontMidi(melodic, take, snapshot));
      await renderSoundFontMidi(melodicMidiPath, melodicPath, soundFontPath, undefined, snapshot);
      await mixWav([melodicPath, percussionPath], wavPath);
    } else {
      await writeFile(wavPath, await readFile(percussionPath));
    }
    return wavPath;
  }
  if (!soundFontPath) throw new Error("SoundFont export requires a SoundFont file");
  await renderSoundFontMidi(midiPath, wavPath, soundFontPath, undefined, snapshot);
  return wavPath;
}

const NEON_RENDER_CHUNK_FRAMES = 480;

export async function renderNeonWav(recording: RecordedMidiEvent[], take: Take, snapshot: EngineSnapshot): Promise<Buffer> {
  const sampleRate = 48_000;
  const cycleSeconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const frameCount = Math.round(cycleSeconds * sampleRate);
  const synth = new NeonPressureSynth(sampleRate, snapshot.synth.parameterValues as unknown as Partial<NeonPressureParameters>);
  const output = new Float32Array(frameCount * 2);
  const events = rotateRecording(recording, snapshot.capture.loopStart).sort((left, right) => left.position - right.position);
  let eventIndex = 0;
  let frame = 0;
  while (frame < frameCount) {
    while (eventIndex < events.length) {
      const { position, event } = events[eventIndex]!;
      const eventFrame = Math.max(frame, Math.min(frameCount, Math.round(position * frameCount)));
      if (eventFrame > frame) break;
      if (event.channel !== 9) {
        synth.dispatchMidi(event.type === "note-on" ? { ...event, velocity: Math.round(event.velocity * take.level) } : event);
      }
      eventIndex += 1;
    }

    const nextEventFrame = eventIndex < events.length
      ? Math.max(frame, Math.min(frameCount, Math.round(events[eventIndex]!.position * frameCount)))
      : frameCount;
    const chunkEnd = Math.min(frame + NEON_RENDER_CHUNK_FRAMES, nextEventFrame, frameCount);
    output.set(synth.render(chunkEnd - frame), frame * 2);
    frame = chunkEnd;
    if (frame < frameCount) await yieldToEventLoop();
  }
  return encodePcm16Wav(output, sampleRate);
}

export function recordingToMidi(recording: RecordedMidiEvent[], take: Take, snapshot: EngineSnapshot): Uint8Array {
  const ticksPerBeat = 480;
  const totalTicks = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures * ticksPerBeat;
  const preset = snapshot.synth.soundFontPresets.find(({ id }) => id === snapshot.synth.selectedSoundFontPresetId);
  const drumKit = snapshot.pads.drumKits.find(({ id }) => id === snapshot.pads.selectedDrumKitId);
  const tracks = new Map<number, Array<{ tick: number; priority: number; event: FileMidiEvent }>>();
  const activeNoteTicks = new Map<string, number[]>();
  const trackFor = (channel: number) => {
    let track = tracks.get(channel);
    if (!track) {
      track = [];
      if (channel !== 9) {
        const bank = preset?.bank ?? 0;
        track.push(
          { tick: 0, priority: 0, event: { deltaTime: 0, type: "controller", channel, controllerType: 0, value: bank >> 7 } },
          { tick: 0, priority: 1, event: { deltaTime: 0, type: "controller", channel, controllerType: 32, value: bank & 0x7f } },
          { tick: 0, priority: 2, event: { deltaTime: 0, type: "programChange", channel, programNumber: preset?.program ?? 0 } },
          { tick: 0, priority: 3, event: { deltaTime: 0, type: "controller", channel, controllerType: 93, value: Math.round((snapshot.synth.parameterValues["chorus-send"] ?? 0) * 127) } },
          { tick: 0, priority: 3, event: { deltaTime: 0, type: "controller", channel, controllerType: 91, value: Math.round((snapshot.synth.parameterValues["reverb-send"] ?? 0) * 127) } },
        );
      } else {
        track.push({ tick: 0, priority: 2, event: { deltaTime: 0, type: "programChange", channel, programNumber: drumKit?.program ?? 0 } });
      }
      tracks.set(channel, track);
    }
    return track;
  };

  for (const { position, event } of rotateRecording(recording, snapshot.capture.loopStart)) {
    let tick = Math.max(0, Math.min(totalTicks, Math.round(position * totalTicks)));
    const track = trackFor(event.channel);
    if (event.type === "note-on" && event.velocity > 0) {
      const key = `${event.channel}:${event.note}`;
      const starts = activeNoteTicks.get(key) ?? [];
      starts.push(tick);
      activeNoteTicks.set(key, starts);
      track.push({ tick, priority: 5, event: { deltaTime: 0, type: "noteOn", channel: event.channel, noteNumber: event.note, velocity: Math.round(event.velocity * take.level) } });
    } else if (event.type === "note-off" || event.type === "note-on" && event.velocity === 0) {
      const key = `${event.channel}:${event.note}`;
      const startTick = activeNoteTicks.get(key)?.shift();
      if (startTick !== undefined && tick <= startTick) tick = startTick + 1;
      track.push({ tick, priority: 4, event: { deltaTime: 0, type: "noteOff", channel: event.channel, noteNumber: event.note, velocity: 0 } });
    } else if (event.type === "control-change") {
      track.push({ tick, priority: 3, event: { deltaTime: 0, type: "controller", channel: event.channel, controllerType: event.controller, value: event.value } });
    } else if (event.type === "pitch-bend") {
      track.push({ tick, priority: 3, event: { deltaTime: 0, type: "pitchBend", channel: event.channel, value: Math.max(-8_192, Math.min(8_191, Math.round(event.value * 8_192))) } });
    }
  }

  const encodedTracks = [...tracks.values()].map((events): FileMidiEvent[] => {
    let previousTick = 0;
    const encoded = events.sort((left, right) => left.tick - right.tick || left.priority - right.priority).map(({ tick, event }) => {
      const withDelta = { ...event, deltaTime: tick - previousTick } as FileMidiEvent;
      previousTick = tick;
      return withDelta;
    });
    encoded.push({ deltaTime: Math.max(0, totalTicks - previousTick), type: "endOfTrack", meta: true });
    return encoded;
  });
  const headerTrack: FileMidiEvent[] = [
    { deltaTime: 0, type: "setTempo", meta: true, microsecondsPerBeat: Math.round(60_000_000 / snapshot.settings.bpm) },
    { deltaTime: 0, type: "timeSignature", meta: true, numerator: snapshot.settings.beatsPerMeasure, denominator: 4, metronome: 24, thirtyseconds: 8 },
    { deltaTime: totalTicks, type: "endOfTrack", meta: true },
  ];
  return Uint8Array.from(writeMidi({ header: { format: 1, numTracks: encodedTracks.length + 1, ticksPerBeat }, tracks: [headerTrack, ...encodedTracks] }));
}

export function recordingToSoundFontMidi(recording: RecordedMidiEvent[], take: Take, snapshot: EngineSnapshot): Uint8Array {
  return recordingToMidi(recording.filter(({ event }) => !isMappedDrumPadRelease(event)), take, snapshot);
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
    "-o", `synth.reverb.width=${params["reverb-width"] ?? 0.5}`,
  ];
  if (percussionSoundFontPath) args.push(percussionSoundFontPath);
  args.push(soundFontPath, midiPath);
  await run("fluidsynth", args);
}

export async function mixWavsToCyclePcm(inputs: string[], output: string, frameCount: number): Promise<void> {
  const filters = inputs.map((_, index) => `[${index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end_sample=${frameCount}[a${index}]`);
  const streams = inputs.map((_, index) => `[a${index}]`).join("");
  filters.push(`${streams}amix=inputs=${inputs.length}:duration=longest:normalize=0:dropout_transition=0,pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,atrim=end_sample=${frameCount},asetpts=N/SR/TB[out]`);
  const args = inputs.flatMap((input) => ["-i", input]);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-f", "s16le", output);
  await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", ...args]);
}

export async function encodeSamplePcmMp3(pcmPath: string, mp3Path: string, startFrame: number): Promise<void> {
  await run("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", pcmPath, "-map", "0:a:0",
    "-af", `atrim=start_sample=${startFrame},asetpts=N/SR/TB`,
    "-codec:a", "libmp3lame", "-q:a", "2", "-write_xing", "1", "-f", "mp3", mp3Path,
  ]);
}

export async function encodeMp3(wavPath: string, mp3Path: string): Promise<void> {
  await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", wavPath, "-map", "0:a:0", "-ar", "48000", "-ac", "2", "-codec:a", "libmp3lame", "-q:a", "2", "-write_xing", "1", "-f", "mp3", mp3Path]);
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
    let childError: Error | null = null;
    let timedOut = false;
    const timeoutMs = 120_000;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_192); });
    child.once("error", (error) => { childError = error; });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) return reject(new Error(`${command} timed out after ${timeoutMs} ms`));
      if (childError) return reject(childError);
      if (code !== 0) return reject(new Error(`${command} exited ${signal ?? code}: ${stderr.trim()}`));
      resolve();
    });
  });
}
