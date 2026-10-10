import { writeFile, rm, copyFile } from "node:fs/promises";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { join } from "node:path";
import { writeMidi, type MidiEvent as FileMidiEvent } from "midi-file";
import { NeonPressureSynth, type NeonPressureParameters } from "@alesis/audio";
import type { EngineSnapshot, Take } from "@alesis/protocol";
import { isMappedDrumPadRelease } from "./sample-pads.js";
import type { RecordedMidiEvent } from "./loop-playback.js";
import { rotateRecording } from "./circular-recording.js";
import { checkRenderCancellation, runRenderProcess as run } from "./render-process.js";
import { CYCLE_SAMPLE_RATE, cycleRenderEvents, cycleRenderSchedule, type CycleRenderSchedule } from "./cycle-render-schedule.js";

export interface TakeWavRenderRequest {
  recording: RecordedMidiEvent[];
  take: Take;
  snapshot: EngineSnapshot;
  temporaryDirectory: string;
  baseName: string;
  soundFontPath?: string;
  percussionSoundFontPath?: string;
  cyclePolicy?: "include-wrapped-tails";
}

export async function renderTakeWav(request: TakeWavRenderRequest): Promise<string> {
  if (request.cyclePolicy === "include-wrapped-tails") return renderWarmTakeWav(request);
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
      await renderSoundFontMidi(percussionMidiPath, percussionPath, percussionSoundFontPath, snapshot);
      await mixWav([neonPath, percussionPath], wavPath);
    } else await copyFile(neonPath, wavPath);
    return wavPath;
  }
  if (percussion.length > 0 && percussionSoundFontPath) {
    const percussionMidiPath = join(temporaryDirectory, `${baseName}-percussion.mid`);
    const percussionPath = join(temporaryDirectory, `${baseName}-percussion.wav`);
    await writeFile(percussionMidiPath, recordingToSoundFontMidi(percussion, take, snapshot));
    await renderSoundFontMidi(percussionMidiPath, percussionPath, percussionSoundFontPath, snapshot);
    if (melodic.length > 0) {
      if (!soundFontPath) throw new Error("Melodic SoundFont export requires a SoundFont file");
      const melodicMidiPath = join(temporaryDirectory, `${baseName}-melodic.mid`);
      const melodicPath = join(temporaryDirectory, `${baseName}-melodic.wav`);
      await writeFile(melodicMidiPath, recordingToSoundFontMidi(melodic, take, snapshot));
      await renderSoundFontMidi(melodicMidiPath, melodicPath, soundFontPath, snapshot);
      await mixWav([melodicPath, percussionPath], wavPath);
    } else await copyFile(percussionPath, wavPath);
    return wavPath;
  }
  if (!soundFontPath) throw new Error("SoundFont export requires a SoundFont file");
  await renderSoundFontMidi(midiPath, wavPath, soundFontPath, snapshot);
  return wavPath;
}

async function renderWarmTakeWav(request: TakeWavRenderRequest): Promise<string> {
  const { recording, take, snapshot, temporaryDirectory, baseName, soundFontPath, percussionSoundFontPath } = request;
  const seconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const schedule = cycleRenderSchedule(recording, snapshot.capture.loopStart, take.level, seconds);
  if (schedule.frames * 4 + 44 > 256 * 1024 * 1024) throw new Error("Prepared export exceeds 256 MiB limit");
  const wavPath = join(temporaryDirectory, `${baseName}.wav`);
  const parts: string[] = [];
  const melodic = { ...schedule, events: schedule.events.filter(({ event }) => event.channel !== 9) };
  const percussion = { ...schedule, events: schedule.events.filter(({ event }) => event.channel === 9) };
  const soundFontPart = async (part: CycleRenderSchedule, font: string, name: string) => {
    const midi = join(temporaryDirectory, `${baseName}-${name}.mid`);
    const warm = join(temporaryDirectory, `${baseName}-${name}-warm.wav`);
    const path = join(temporaryDirectory, `${baseName}-${name}.wav`);
    await writeFile(midi, await cycleToSoundFontMidi(part, snapshot));
    await renderSoundFontMidi(midi, warm, font, snapshot);
    const start = part.warmupCycles * part.frames;
    await run("ffmpeg", ["-nostdin", "-v", "error", "-i", warm, "-af", `atrim=start_sample=${start}:end_sample=${start + part.frames},asetpts=N/SR/TB`, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", path]);
    // The multi-cycle file is disk-backed; only the extracted cycle survives.
    await rm(warm);
    parts.push(path);
  };
  if (snapshot.synth.selectedId === "subtractive") {
    const path = join(temporaryDirectory, `${baseName}-neon.wav`);
    await writeFile(path, await renderWarmNeonWav(melodic, snapshot));
    parts.push(path);
  } else if (melodic.events.length > 0 || percussion.events.length === 0) {
    if (!soundFontPath) throw new Error("Melodic SoundFont export requires a SoundFont file");
    await soundFontPart(melodic, soundFontPath, "melodic");
  }
  if (percussion.events.length > 0) {
    const font = percussionSoundFontPath ?? soundFontPath;
    if (!font) throw new Error("Percussion export requires a percussion SoundFont file");
    await soundFontPart(percussion, font, "percussion");
  }
  if (parts.length > 1) await mixWav(parts, wavPath);
  else await copyFile(parts[0]!, wavPath);
  return wavPath;
}

async function renderWarmNeonWav(schedule: CycleRenderSchedule, snapshot: EngineSnapshot): Promise<Buffer> {
  const synth = new NeonPressureSynth(CYCLE_SAMPLE_RATE, snapshot.synth.parameterValues as unknown as Partial<NeonPressureParameters>);
  const output = pcm16WavBuffer(schedule.frames, CYCLE_SAMPLE_RATE);
  const start = schedule.warmupCycles * schedule.frames;
  const end = start + schedule.frames;
  let frame = 0;
  const renderUntil = async (target: number) => {
    while (frame < target) {
      checkRenderCancellation();
      const count = Math.min(480, target - frame);
      const block = synth.render(count);
      for (let i = Math.max(0, start - frame); i < count; i++) {
        writePcm16(output, 44 + (frame + i - start) * 4, block[i * 2]!);
        writePcm16(output, 46 + (frame + i - start) * 4, block[i * 2 + 1]!);
      }
      frame += count;
      await yieldToEventLoop();
    }
  };
  for (const item of cycleRenderEvents(schedule)) {
    await renderUntil(item.frame);
    // Includes events exactly at frameCount: the next cycle must inherit release,
    // bend and pedal state, not a still-held voice from the preceding render.
    synth.dispatchMidi(item.event);
  }
  await renderUntil(end);
  checkRenderCancellation();
  return output;
}

async function cycleToSoundFontMidi(schedule: CycleRenderSchedule, snapshot: EngineSnapshot): Promise<Uint8Array> {
  // One tick per PCM frame: repeated cycles do not accumulate rounded BPM drift.
  const track: FileMidiEvent[] = [{ deltaTime: 0, type: "setTempo", microsecondsPerBeat: 500_000, meta: true }];
  const preset = snapshot.synth.soundFontPresets.find(({ id }) => id === snapshot.synth.selectedSoundFontPresetId);
  const kit = snapshot.pads.drumKits.find(({ id }) => id === snapshot.pads.selectedDrumKitId);
  for (const channel of new Set(schedule.events.map(({ event }) => event.channel))) {
    if (channel !== 9) {
      const bank = preset?.bank ?? 0;
      track.push(
        { deltaTime: 0, type: "controller", channel, controllerType: 0, value: bank >> 7 },
        { deltaTime: 0, type: "controller", channel, controllerType: 32, value: bank & 127 },
      );
    }
    track.push({ deltaTime: 0, type: "programChange", channel, programNumber: (channel === 9 ? kit : preset)?.program ?? 0 });
    // Match the existing percussion renderer's default sends.
    if (channel !== 9) for (const [controllerType, key] of [[91, "reverb-send"], [93, "chorus-send"]] as const) {
      track.push({ deltaTime: 0, type: "controller", channel, controllerType, value: Math.round((snapshot.synth.parameterValues[key] ?? 0) * 127) });
    }
  }
  let previous = 0;
  let count = 0;
  for (const { frame, event } of cycleRenderEvents(schedule)) {
    if (++count % 512 === 0) await yieldToEventLoop();
    checkRenderCancellation();
    const deltaTime = frame - previous;
    let midi: FileMidiEvent;
    if (event.type === "note-on") midi = { deltaTime, type: "noteOn", channel: event.channel, noteNumber: event.note, velocity: event.velocity };
    else if (event.type === "note-off") midi = { deltaTime, type: "noteOff", channel: event.channel, noteNumber: event.note, velocity: 0 };
    else if (event.type === "control-change") midi = { deltaTime, type: "controller", channel: event.channel, controllerType: event.controller, value: event.value };
    else if (event.type === "pitch-bend") midi = { deltaTime, type: "pitchBend", channel: event.channel, value: Math.max(-8192, Math.min(8191, Math.round(event.value * 8192))) };
    else continue;
    track.push(midi);
    previous = frame;
  }
  track.push({ deltaTime: (schedule.warmupCycles + 1) * schedule.frames - previous, type: "endOfTrack", meta: true });
  return Uint8Array.from(writeMidi({ header: { format: 0, numTracks: 1, ticksPerBeat: 24_000 }, tracks: [track] }));
}

export async function renderNeonWav(recording: RecordedMidiEvent[], take: Take, snapshot: EngineSnapshot): Promise<Buffer> {
  const sampleRate = 48_000;
  const cycleSeconds = 60 / snapshot.settings.bpm * snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const frameCount = Math.round(cycleSeconds * sampleRate);
  const synth = new NeonPressureSynth(sampleRate, snapshot.synth.parameterValues as unknown as Partial<NeonPressureParameters>);
  if (frameCount * 4 + 44 > 256 * 1024 * 1024) throw new Error("Prepared export exceeds 256 MiB limit");
  const output = pcm16WavBuffer(frameCount, sampleRate);
  const events = rotateRecording(recording, snapshot.capture.loopStart).sort((left, right) => left.position - right.position);
  let eventIndex = 0;
  let frame = 0;
  while (frame < frameCount) {
    checkRenderCancellation();
    while (eventIndex < events.length) {
      const { position, event } = events[eventIndex]!;
      const eventFrame = Math.max(frame, Math.min(frameCount, Math.round(position * frameCount)));
      if (eventFrame > frame) break;
      if (event.channel !== 9) synth.dispatchMidi(event.type === "note-on" ? { ...event, velocity: Math.round(event.velocity * take.level) } : event);
      eventIndex += 1;
    }
    const nextEventFrame = eventIndex < events.length
      ? Math.max(frame, Math.min(frameCount, Math.round(events[eventIndex]!.position * frameCount))) : frameCount;
    const chunkEnd = Math.min(frame + 480, nextEventFrame, frameCount);
    const block = synth.render(chunkEnd - frame);
    for (let i = 0; i < block.length; i++) writePcm16(output, 44 + frame * 4 + i * 2, block[i]!);
    frame = chunkEnd;
    if (frame < frameCount) await yieldToEventLoop();
  }
  return output;
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
      } else track.push({ tick: 0, priority: 2, event: { deltaTime: 0, type: "programChange", channel, programNumber: drumKit?.program ?? 0 } });
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

async function renderSoundFontMidi(midiPath: string, wavPath: string, soundFontPath: string, snapshot: EngineSnapshot): Promise<void> {
  const params = snapshot.synth.parameterValues;
  await run("fluidsynth", [
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
    soundFontPath, midiPath,
  ]);
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
  await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", pcmPath, "-map", "0:a:0", "-af", `atrim=start_sample=${startFrame},asetpts=N/SR/TB`, "-codec:a", "libmp3lame", "-q:a", "2", "-write_xing", "1", "-f", "mp3", mp3Path]);
}
export async function encodeMp3(wavPath: string, mp3Path: string): Promise<void> {
  await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", wavPath, "-map", "0:a:0", "-ar", "48000", "-ac", "2", "-codec:a", "libmp3lame", "-q:a", "2", "-write_xing", "1", "-f", "mp3", mp3Path]);
}
export async function mixMp3(inputs: string[], output: string): Promise<void> {
  const args = inputs.flatMap((input) => ["-i", input]);
  args.push("-filter_complex", `amix=inputs=${inputs.length}:duration=longest:normalize=1`, "-codec:a", "libmp3lame", "-q:a", "2", output);
  await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", ...args]);
}
async function mixWav(inputs: string[], output: string): Promise<void> {
  const args = inputs.flatMap((input) => ["-i", input]);
  args.push("-filter_complex", `amix=inputs=${inputs.length}:duration=longest:normalize=0`, "-c:a", "pcm_s16le", output);
  await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", ...args]);
}
function writePcm16(wav: Buffer, offset: number, value: number): void {
  const sample = Math.max(-1, Math.min(1, value));
  wav.writeInt16LE(Math.round(sample < 0 ? sample * 32_768 : sample * 32_767), offset);
}
function pcm16WavBuffer(frames: number, sampleRate: number): Buffer {
  const dataSize = frames * 4;
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
  return wav;
}
