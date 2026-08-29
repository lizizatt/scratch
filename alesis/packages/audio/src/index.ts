import { spawn, execFileSync, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { MidiEvent } from "@alesis/engine";
import { NeonPressureSynth, type NeonPressureParameters } from "./renderers.js";

export interface AudioOutput {
  readonly id: string;
  readonly name: string;
  start(): Promise<void>;
  dispatchMidi(event: MidiEvent): void;
  playMetronome(accent: boolean, volume: number): void;
  playDrum(note: number, velocity: number): void;
  loadSoundFont(path: string): Promise<void>;
  selectSoundFontPreset(bank: number, program: number): void;
  selectSynth(synthId: string): Promise<void>;
  setSynthParameter(synthId: string, parameterId: string, value: number): void;
  close(): Promise<void>;
}

export interface PulseAudioDevice {
  id: string;
  name: string;
}

export interface SoundFontFile {
  id: string;
  name: string;
  path: string;
}

export interface SoundFontPreset {
  id: string;
  bank: number;
  program: number;
  name: string;
}

interface SoundFontParameterValues {
  bank: number;
  program: number;
  gain: number;
  "chorus-send": number;
  "reverb-send": number;
  "chorus-rate": number;
  "chorus-depth": number;
  "chorus-voices": number;
  "reverb-room": number;
  "reverb-damping": number;
  "reverb-width": number;
}

const soundFontParameterRanges: Record<keyof SoundFontParameterValues, readonly [number, number]> = {
  bank: [0, 16_383],
  program: [0, 127],
  gain: [0, 1],
  "chorus-send": [0, 0.5],
  "reverb-send": [0, 0.5],
  "chorus-rate": [0.2, 2],
  "chorus-depth": [0, 20],
  "chorus-voices": [0, 8],
  "reverb-room": [0, 1],
  "reverb-damping": [0, 1],
  "reverb-width": [0, 1],
};

const performanceChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14];

export interface FluidSynthOptions {
  device: PulseAudioDevice;
  soundFontPath?: string;
  gain?: number;
  percussionSoundFontPath?: string;
  commandObserver?: (command: string) => void;
}

export const fluidSynthStdio: ["pipe", "pipe", "pipe"] = ["pipe", "pipe", "pipe"];

export function drainFluidSynthStdout(stdout: Readable): void {
  stdout.resume();
}

export function waitForFluidSynthShell(stdin: Writable, stdout: Readable, timeoutMs = 5_000): Promise<void> {
  const token = `ALESIS_READY_${randomUUID()}`;
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => finish(new Error("FluidSynth command shell did not become ready")), timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      output += String(chunk);
      if (output.includes(token)) finish();
      else if (output.length > token.length * 4) output = output.slice(-token.length * 2);
    };
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      stdout.off("data", onData);
      if (error) reject(error);
      else resolve();
    };
    stdout.on("data", onData);
    stdin.write(`echo ${token}\n`);
  });
}

export function isFluidSynthRendererStalled(message: string): boolean {
  return /Ringbuffer full|Failed to allocate a synthesis process/i.test(message);
}

export class SilentAudioOutput implements AudioOutput {
  readonly id = "simulated-output";
  readonly name = "Simulated output";
  async start(): Promise<void> {}
  dispatchMidi(): void {}
  playMetronome(): void {}
  playDrum(): void {}
  async loadSoundFont(): Promise<void> {}
  selectSoundFontPreset(): void {}
  async selectSynth(): Promise<void> {}
  setSynthParameter(): void {}
  async close(): Promise<void> {}
}

export class NeonPressureOutput {
  private readonly synth = new NeonPressureSynth();
  private process: ChildProcessWithoutNullStreams | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deviceId: string) {}

  async start(): Promise<void> {
    if (this.process) return;
    const child = spawn("pw-cat", ["--playback", "--target", this.deviceId, "--rate", "48000", "--channels", "2", "--format", "f32", "-"], {
      stdio: fluidSynthStdio,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.once("exit", () => {
      if (this.process === child) this.process = null;
    });
    this.process = child;
    this.timer = setInterval(() => {
      if (!child.stdin.writable || child.stdin.writableLength > 48_000) return;
      const samples = this.synth.render(480);
      child.stdin.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    }, 10);
  }

  dispatchMidi(event: MidiEvent): void {
    this.synth.dispatchMidi(event);
  }

  setParameter(parameterId: string, value: number): void {
    this.synth.setParameter(parameterId as keyof NeonPressureParameters, value);
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const child = this.process;
    this.process = null;
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    if (await waitForExit(child, 500)) return;
    child.kill("SIGTERM");
    await waitForExit(child, 500);
  }
}

export class FluidSynthOutput implements AudioOutput {
  readonly id: string;
  readonly name: string;
  private process: ChildProcessWithoutNullStreams | null = null;
  private soundFontPath: string;
  private readonly gain: number;
  private readonly percussionSoundFontPath: string | null;
  private clickTimers = new Set<ReturnType<typeof setTimeout>>();
  private recovery: Promise<void> | null = null;
  private closing = false;
  private readonly soundFontParameters: SoundFontParameterValues;
  private readonly neonOutput: NeonPressureOutput;
  private selectedSynthId = "soundfont";

  constructor(private readonly options: FluidSynthOptions) {
    this.id = `pulse:${options.device.id}`;
    this.name = options.device.name;
    this.soundFontPath = options.soundFontPath ?? "/usr/share/sounds/sf2/FluidR3_GM.sf2";
    this.gain = options.gain ?? 0.6;
    const defaultPercussion = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
    this.percussionSoundFontPath = options.percussionSoundFontPath ?? (existsSync(defaultPercussion) ? defaultPercussion : null);
    this.soundFontParameters = { bank: 0, program: 0, gain: this.gain, "chorus-send": 0.12, "reverb-send": 0.24, "chorus-rate": 0.3, "chorus-depth": 8, "chorus-voices": 3, "reverb-room": 0.2, "reverb-damping": 0, "reverb-width": 0.5 };
    this.neonOutput = new NeonPressureOutput(options.device.id);
  }

  async start(): Promise<void> {
    if (this.process) return;
    this.closing = false;
    await this.launch();
  }

  private async launch(): Promise<void> {
    if (!existsSync(this.soundFontPath)) throw new Error(`SoundFont not found: ${this.soundFontPath}`);
    const child = spawn("fluidsynth", fluidSynthArguments(this.options.device.id, this.soundFontPath, this.gain, this.percussionSoundFontPath), {
      stdio: fluidSynthStdio,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.once("exit", () => {
      if (this.process === child) this.process = null;
    });
    child.stdin.on("error", () => {});
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (isFluidSynthRendererStalled(message)) {
        this.recover(child);
        return;
      }
      if (message && !message.includes("Failed to set thread to high priority")) console.error(message);
    });
    this.process = child;
    await waitForFluidSynthShell(child.stdin, child.stdout);
    drainFluidSynthStdout(child.stdout);
    this.applySoundFontParameters();
  }

  dispatchMidi(event: MidiEvent): void {
    if (this.selectedSynthId === "subtractive") {
      this.neonOutput.dispatchMidi(event);
      return;
    }
    const command = midiEventToFluidCommand(event);
    if (command) this.writeCommand(command);
  }

  playMetronome(accent: boolean, volume: number): void {
    const commands = metronomeCommands(accent, volume);
    if (!commands) return;
    this.writeCommand(commands.noteOn);
    const timer = setTimeout(() => {
      this.clickTimers.delete(timer);
      this.writeCommand(commands.noteOff);
    }, 45);
    this.clickTimers.add(timer);
  }

  playDrum(note: number, velocity: number): void {
    const commands = drumCommands(note, velocity);
    this.writeCommand(commands.noteOn);
    const timer = setTimeout(() => {
      this.clickTimers.delete(timer);
      this.writeCommand(commands.noteOff);
    }, 80);
    this.clickTimers.add(timer);
  }

  async loadSoundFont(path: string): Promise<void> {
    if (path === this.soundFontPath) return;
    if (!existsSync(path)) throw new Error(`SoundFont not found: ${path}`);
    const previousPath = this.soundFontPath;
    const child = this.process;
    this.process = null;
    this.soundFontPath = path;
    if (child) await stopFluidSynth(child);
    try {
      await this.launch();
    } catch (error) {
      this.soundFontPath = previousPath;
      await this.launch();
      throw error;
    }
  }

  selectSoundFontPreset(bank: number, program: number): void {
    this.soundFontParameters.bank = bank;
    this.soundFontParameters.program = program;
    for (const command of soundFontSelectionCommands(bank, program)) this.writeCommand(command);
  }

  async selectSynth(synthId: string): Promise<void> {
    if (synthId === this.selectedSynthId) return;
    if (synthId === "subtractive") {
      this.writeCommand("reset");
      await this.neonOutput.start();
    } else if (synthId === "soundfont") {
      await this.neonOutput.close();
      this.writeCommand("reset");
    } else {
      throw new Error(`Unknown synth: ${synthId}`);
    }
    this.selectedSynthId = synthId;
  }

  setSynthParameter(synthId: string, parameterId: string, value: number): void {
    if (synthId === "subtractive") {
      this.neonOutput.setParameter(parameterId, value);
      return;
    }
    if (!(parameterId in this.soundFontParameters)) throw new Error(`Unknown SoundFont parameter: ${parameterId}`);
    this.soundFontParameters[parameterId as keyof SoundFontParameterValues] = value;
    for (const command of soundFontParameterCommands(parameterId, value, this.soundFontParameters)) this.writeCommand(command);
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const timer of this.clickTimers) clearTimeout(timer);
    this.clickTimers.clear();
    if (this.recovery) await this.recovery;
    const child = this.process;
    this.process = null;
    await this.neonOutput.close();
    if (child) await stopFluidSynth(child);
  }

  private writeCommand(command: string): void {
    this.options.commandObserver?.(command);
    if (this.process?.stdin.writable) this.process.stdin.write(`${command}\n`);
  }

  private applySoundFontParameters(): void {
    for (const command of soundFontInitializationCommands(this.soundFontParameters)) this.writeCommand(command);
    this.writeCommand(percussionSelectionCommand(this.percussionSoundFontPath !== null));
  }

  private recover(child: ChildProcessWithoutNullStreams): void {
    if (this.closing || this.process !== child || this.recovery) return;
    console.error("FluidSynth renderer stalled; restarting audio output");
    this.process = null;
    const recovery = (async () => {
      await stopFluidSynth(child);
      if (this.closing) return;
      await this.launch();
      console.error("FluidSynth audio output recovered");
    })().catch((error) => {
      console.error(`FluidSynth audio recovery failed: ${String(error)}`);
    }).finally(() => {
      if (this.recovery === recovery) this.recovery = null;
    });
    this.recovery = recovery;
  }
}

async function stopFluidSynth(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  if (child.stdin.writable) child.stdin.end("quit\n");
  if (await waitForExit(child, 500)) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 500)) return;
  child.kill("SIGKILL");
  await waitForExit(child, 500);
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (): void => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const finish = (exited: boolean): void => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      resolve(exited);
    };
    child.once("exit", onExit);
  });
}

export function discoverDefaultPulseAudioDevice(): PulseAudioDevice | null {
  try {
    const id = execFileSync("pactl", ["get-default-sink"], { encoding: "utf8" }).trim();
    if (!id) return null;
    const rows = execFileSync("pactl", ["list", "short", "sinks"], { encoding: "utf8" });
    const row = rows.split("\n").find((line) => line.split("\t")[1] === id);
    const name = id.includes("sofhdadsp__sink") ? "System Speakers" : row?.split("\t")[1] ?? id;
    return { id, name };
  } catch {
    return null;
  }
}

export function discoverSoundFonts(directories = [join(homedir(), "Downloads"), "/usr/share/sounds/sf2", "/usr/share/sounds/sf3"]): SoundFontFile[] {
  const files = directories.flatMap(findSoundFontFiles);
  const usedIds = new Set<string>();
  return files.sort((left, right) => basename(left).localeCompare(basename(right))).map((path) => {
    const filename = basename(path);
    const baseId = filename.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    return { id, name: filename.slice(0, -extname(filename).length), path };
  });
}

function findSoundFontFiles(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return findSoundFontFiles(path);
      return entry.isFile() && [".sf2", ".sf3"].includes(extname(entry.name).toLowerCase()) ? [path] : [];
    });
  } catch {
    return [];
  }
}

export function preferredSoundFont(soundFonts: SoundFontFile[]): SoundFontFile | null {
  return soundFonts.find(({ name }) => /hs synthetic electronic/i.test(name))
    ?? soundFonts.find(({ name }) => /sonic|^sth$/i.test(name))
    ?? soundFonts.find(({ name }) => /fluidr3/i.test(name))
    ?? soundFonts[0]
    ?? null;
}

export function discoverSoundFontPresets(path: string): SoundFontPreset[] {
  const result = spawnSync("fluidsynth", ["-a", "file", "-o", "audio.file.name=/dev/null", path], {
    input: "inst 1\nquit\n",
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Unable to inspect SoundFont: ${result.stderr.trim()}`);
  return parseSoundFontPresets(`${result.stdout}\n${result.stderr}`);
}

export function parseSoundFontPresets(output: string): SoundFontPreset[] {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^(\d+)-(\d+)\s+(.+?)\s*$/);
    if (!match) return [];
    const bank = Number(match[1]);
    const program = Number(match[2]);
    if (bank > 16_383 || program > 127) return [];
    return [{ id: `${bank}:${program}`, bank, program, name: match[3]! }];
  });
}

export function soundFontParameterCommands(parameterId: string, value: number, selection = { bank: 0, program: 0 }): string[] {
  const range = soundFontParameterRanges[parameterId as keyof SoundFontParameterValues];
  if (!range) throw new Error(`Unknown SoundFont parameter: ${parameterId}`);
  if (!Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error(`SoundFont parameter out of range: ${parameterId}=${value}`);
  switch (parameterId) {
    case "bank": return soundFontSelectionCommands(Math.round(value), selection.program);
    case "program": return soundFontSelectionCommands(selection.bank, Math.round(value));
    case "gain": return [`gain ${value}`];
    case "chorus-send": return [
      `chorus ${value > 0 ? 1 : 0}`,
      "cho_set_level 0.3",
      ...performanceChannels.map((channel) => `cc ${channel} 93 ${Math.round(value * 127)}`),
    ];
    case "reverb-send": return [
      `reverb ${value > 0 ? 1 : 0}`,
      "rev_setlevel 0.3",
      ...performanceChannels.map((channel) => `cc ${channel} 91 ${Math.round(value * 127)}`),
    ];
    case "chorus-rate": return [`cho_set_speed ${value}`];
    case "chorus-depth": return [`cho_set_depth ${value}`];
    case "chorus-voices": return [`cho_set_nr ${Math.round(value)}`];
    case "reverb-room": return [`rev_setroomsize ${value}`];
    case "reverb-damping": return [`rev_setdamp ${value}`];
    case "reverb-width": return [`rev_setwidth ${value * 100}`];
    default: throw new Error(`Unknown SoundFont parameter: ${parameterId}`);
  }
}

export function soundFontInitializationCommands(parameters: SoundFontParameterValues): string[] {
  return [
    ...soundFontSelectionCommands(parameters.bank, parameters.program),
    "select 15 1 0 0",
    ...["gain", "chorus-rate", "chorus-depth", "chorus-voices", "reverb-room", "reverb-damping", "reverb-width", "chorus-send", "reverb-send"].flatMap((parameterId) =>
      soundFontParameterCommands(parameterId, parameters[parameterId as keyof SoundFontParameterValues], parameters)),
  ];
}

function soundFontSelectionCommands(bank: number, program: number): string[] {
  return performanceChannels.map((channel) => `select ${channel} 1 ${Math.round(bank)} ${Math.round(program)}`);
}

export function fluidSynthArguments(deviceId: string, soundFontPath: string, gain: number, percussionSoundFontPath?: string | null): string[] {
  const args = [
    "-q",
    "-a", "pulseaudio",
    "-o", `audio.pulseaudio.device=${deviceId}`,
    "-o", `synth.gain=${gain}`,
    soundFontPath,
  ];
  if (percussionSoundFontPath) args.push(percussionSoundFontPath);
  return args;
}

export function midiEventToFluidCommand(event: MidiEvent): string | null {
  switch (event.type) {
    case "note-on": return `noteon ${event.channel} ${event.note} ${event.velocity}`;
    case "note-off": return `noteoff ${event.channel} ${event.note}`;
    case "control-change": return `cc ${event.channel} ${event.controller} ${event.value}`;
    case "pitch-bend": {
      const value = Math.max(0, Math.min(16_383, Math.round((event.value + 1) * 8_191.5)));
      return `pitch_bend ${event.channel} ${value}`;
    }
    case "channel-pressure": return null;
  }
}

export function metronomeCommands(accent: boolean, volume: number): { noteOn: string; noteOff: string } | null {
  if (volume <= 0) return null;
  const note = accent ? 96 : 84;
  const velocity = Math.max(1, Math.min(127, Math.round(volume * 127)));
  return { noteOn: `noteon 15 ${note} ${velocity}`, noteOff: `noteoff 15 ${note}` };
}

export function drumCommands(note: number, velocity: number): { noteOn: string; noteOff: string } {
  const safeNote = Math.max(0, Math.min(127, Math.round(note)));
  const safeVelocity = Math.max(1, Math.min(127, Math.round(velocity)));
  return { noteOn: `noteon 9 ${safeNote} ${safeVelocity}`, noteOff: `noteoff 9 ${safeNote}` };
}

export function percussionSelectionCommand(hasAuxiliarySoundFont: boolean): string {
  // FluidSynth uses SoundFont bank 128 for General MIDI percussion presets.
  return `select 9 ${hasAuxiliarySoundFont ? 2 : 1} 128 0`;
}
