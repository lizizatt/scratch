import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { MidiEvent } from "@alesis/engine";
import { NeonPressureSynth, type NeonPressureParameters } from "./renderers.js";

export { NeonPressureSynth, type NeonPressureParameters } from "./renderers.js";
export { SampleLibrary, SampleMixer, SamplePlayer, SAMPLE_MAX_DURATION_SECONDS, SAMPLE_MAX_FILE_BYTES, SAMPLE_MAX_PAGE_BYTES, SAMPLE_PAGE_SIZE } from "./samples.js";
export type { DecodedSample, SampleDescriptor, SampleLibraryOptions, SamplePlayerOptions } from "./samples.js";

export interface AudioOutput {
  readonly id: string;
  readonly name: string;
  start(): Promise<void>;
  panic(): void;
  dispatchMidi(event: MidiEvent): void;
  playMetronome(accent: boolean, volume: number): void;
  playDrum(note: number, velocity: number): void;
  selectDrumKit(bank: number, program: number): void;
  loadSoundFont(path: string): Promise<void>;
  selectSoundFontPreset(bank: number, program: number): void;
  selectSynth(synthId: string): Promise<void>;
  setSynthParameter(synthId: string, parameterId: string, value: number): void;
  close(): Promise<void>;
}

export interface AlsaAudioDevice {
  id: string;
  name: string;
  usbId: string;
  cardId: string;
  pcm: string;
}

export const CM108_USB_IDS = ["0d8c:000c", "0d8c:013c"] as const;

export function discoverCm108AudioDevice(asoundRoot = "/proc/asound", deviceRoot = "/dev/snd"): AlsaAudioDevice | null {
  if (!existsSync(asoundRoot)) return null;
  const cards = readdirSync(asoundRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^card\d+$/.test(entry.name))
    .sort((left, right) => Number(left.name.slice(4)) - Number(right.name.slice(4)));
  for (const card of cards) {
    const cardNumber = card.name.slice(4);
    const cardRoot = join(asoundRoot, card.name);
    const playbackPath = join(deviceRoot, `pcmC${cardNumber}D0p`);
    try {
      const usbId = readFileSync(join(cardRoot, "usbid"), "utf8").trim().toLowerCase();
      if (!CM108_USB_IDS.includes(usbId as typeof CM108_USB_IDS[number]) || !existsSync(playbackPath)) continue;
      const cardId = readFileSync(join(cardRoot, "id"), "utf8").trim();
      const info = readFileSync(join(cardRoot, "pcm0p", "info"), "utf8");
      const name = info.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? cardId;
      if (!/cm108|c-media|usb(?: pnp sound)? audio/i.test(name)) continue;
      return { id: `alsa:${cardId}`, name, usbId, cardId, pcm: "alesis_cm108" };
    } catch {
      continue;
    }
  }
  return null;
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
  "reverb-send": number;
  "reverb-room": number;
  "reverb-damping": number;
  "reverb-width": number;
}

const soundFontParameterRanges: Record<keyof SoundFontParameterValues, readonly [number, number]> = {
  bank: [0, 16_383],
  program: [0, 127],
  gain: [0, 1],
  "reverb-send": [0, 1],
  "reverb-room": [0, 1],
  "reverb-damping": [0, 1],
  "reverb-width": [0, 1],
};

const performanceChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14];

export interface FluidSynthOptions {
  device: Pick<AlsaAudioDevice, "id" | "name" | "pcm">;
  soundFontPath?: string;
  gain?: number;
  percussionSoundFontPath?: string;
  commandObserver?: (command: string) => void;
  healthObserver?: (ready: boolean, reason?: string) => void;
}

export const fluidSynthStdio: ["pipe", "pipe", "pipe"] = ["pipe", "pipe", "pipe"];
export const FLUIDSYNTH_READY_TIMEOUT_MS = 30_000;

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

export function stereoFloatToDualMonoS16(samples: Float32Array): Buffer {
  if (samples.length % 2 !== 0) throw new Error("Stereo PCM must contain complete frames");
  const output = Buffer.allocUnsafe(samples.length * 2);
  for (let index = 0; index < samples.length; index += 2) {
    const mono = Math.max(-1, Math.min(1, (samples[index]! + samples[index + 1]!) / 2));
    const value = Math.round(mono * 32_767);
    output.writeInt16LE(value, index * 2);
    output.writeInt16LE(value, index * 2 + 2);
  }
  return output;
}

export function alsaPlaybackArguments(pcm: string): string[] {
  return [
    "-q",
    "-D", pcm,
    "-t", "raw",
    "-f", "S16_LE",
    "-r", "48000",
    "-c", "2",
    "--period-size=512",
    "--buffer-size=1024",
  ];
}

export class SilentAudioOutput implements AudioOutput {
  readonly id = "simulated-output";
  readonly name = "Simulated output";
  async start(): Promise<void> {}
  panic(): void {}
  dispatchMidi(): void {}
  playMetronome(): void {}
  playDrum(): void {}
  selectDrumKit(): void {}
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

  private closing = false;

  constructor(private readonly pcm: string, private readonly unexpectedExit?: (reason: string) => void) {}

  async start(): Promise<void> {
    if (this.process) return;
    this.closing = false;
    const child = spawn("aplay", alsaPlaybackArguments(this.pcm), {
      stdio: fluidSynthStdio,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.once("exit", (code, signal) => {
      if (this.process !== child) return;
      this.process = null;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (!this.closing) this.unexpectedExit?.(`Neon playback exited (${signal ?? code ?? "unknown"})`);
    });
    this.process = child;
    this.timer = setInterval(() => {
      if (!child.stdin.writable || child.stdin.writableLength > 48_000) return;
      const samples = this.synth.render(480);
      child.stdin.write(stereoFloatToDualMonoS16(samples));
    }, 10);
  }

  dispatchMidi(event: MidiEvent): void {
    this.synth.dispatchMidi(event);
  }

  setParameter(parameterId: string, value: number): void {
    this.synth.setParameter(parameterId as keyof NeonPressureParameters, value);
  }

  panic(): void {
    this.synth.panic();
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.synth.panic();
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
  private pendingRecoveryReason: string | null = null;
  private closing = false;
  private readonly soundFontParameters: SoundFontParameterValues;
  private readonly neonOutput: NeonPressureOutput;
  private selectedSynthId = "soundfont";
  private percussionBank = 128;
  private percussionProgram = 0;

  constructor(private readonly options: FluidSynthOptions) {
    this.id = options.device.id;
    this.name = options.device.name;
    this.soundFontPath = options.soundFontPath ?? "/usr/share/sounds/sf2/FluidR3_GM.sf2";
    this.gain = options.gain ?? 0.6;
    const defaultPercussion = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
    this.percussionSoundFontPath = options.percussionSoundFontPath ?? (existsSync(defaultPercussion) ? defaultPercussion : null);
    this.soundFontParameters = { bank: 0, program: 0, gain: this.gain, "reverb-send": 0.45, "reverb-room": 0.2, "reverb-damping": 0, "reverb-width": 0.5 };
    this.neonOutput = new NeonPressureOutput(options.device.pcm, (reason) => this.recoverUnexpectedExit(reason));
  }

  async start(): Promise<void> {
    if (this.process) return;
    this.closing = false;
    await this.launch();
    if (this.selectedSynthId === "subtractive") await this.neonOutput.start();
    this.options.healthObserver?.(true);
  }

  private async launch(): Promise<void> {
    if (!existsSync(this.soundFontPath)) throw new Error(`SoundFont not found: ${this.soundFontPath}`);
    const child = spawn("fluidsynth", fluidSynthArguments(this.options.device.pcm, this.soundFontPath, this.gain, this.percussionSoundFontPath), {
      stdio: fluidSynthStdio,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.once("exit", (code, signal) => {
      if (this.process !== child) return;
      this.process = null;
      if (!this.closing) this.recoverUnexpectedExit(`FluidSynth exited (${signal ?? code ?? "unknown"})`);
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
    try {
      await waitForFluidSynthShell(child.stdin, child.stdout, FLUIDSYNTH_READY_TIMEOUT_MS);
    } catch (error) {
      if (this.process === child) this.process = null;
      await stopFluidSynth(child);
      throw error;
    }
    drainFluidSynthStdout(child.stdout);
    this.applySoundFontParameters();
    this.panic();
  }

  panic(): void {
    this.neonOutput.panic();
    for (let channel = 0; channel < 16; channel += 1) {
      for (const command of [
        `cc ${channel} 64 0`,
        `cc ${channel} 120 0`,
        `cc ${channel} 121 0`,
        `cc ${channel} 123 0`,
        `pitch_bend ${channel} 8192`,
      ]) this.writeCommand(command);
    }
  }

  dispatchMidi(event: MidiEvent): void {
    if (this.selectedSynthId === "subtractive" && event.channel !== 9) {
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

  selectDrumKit(bank: number, program: number): void {
    if (!Number.isInteger(bank) || bank < 0 || bank > 16_383) throw new RangeError(`Drum-kit bank out of range: ${bank}`);
    if (!Number.isInteger(program) || program < 0 || program > 127) throw new RangeError(`Drum-kit program out of range: ${program}`);
    this.percussionBank = bank;
    this.percussionProgram = program;
    this.writeCommand(`select 9 ${this.percussionSoundFontId()} ${bank} ${program}`);
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
    this.panic();
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
    for (const command of auxiliaryPercussionSelectionCommands(this.percussionSoundFontPath !== null)) this.writeCommand(command);
    this.writeCommand(`select 9 ${this.percussionSoundFontId()} ${this.percussionBank} ${this.percussionProgram}`);
  }

  private percussionSoundFontId(): number {
    return this.percussionSoundFontPath !== null ? 2 : 1;
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

  private recoverUnexpectedExit(reason: string): void {
    if (this.closing) return;
    this.options.healthObserver?.(false, reason);
    if (this.recovery) {
      this.pendingRecoveryReason = reason;
      return;
    }
    const recovery = (async () => {
      if (!this.process) await this.launch();
      if (this.selectedSynthId === "subtractive") await this.neonOutput.start();
      if (!this.pendingRecoveryReason) this.options.healthObserver?.(true);
    })().catch((error) => {
      this.options.healthObserver?.(false, `Audio recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      if (this.recovery !== recovery) return;
      this.recovery = null;
      const pendingReason = this.pendingRecoveryReason;
      this.pendingRecoveryReason = null;
      if (pendingReason) this.recoverUnexpectedExit(pendingReason);
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
    case "reverb-send": return [
      `reverb ${value > 0 ? 1 : 0}`,
      `rev_setlevel ${value}`,
      ...performanceChannels.map((channel) => `cc ${channel} 91 ${value > 0 ? 127 : 0}`),
    ];
    case "reverb-room": return [`rev_setroomsize ${value}`];
    case "reverb-damping": return [`rev_setdamp ${value}`];
    // Widths above 1 exaggerate the side signal and suppress tails in the Pi's mono mix.
    case "reverb-width": return [`rev_setwidth ${value}`];
    default: throw new Error(`Unknown SoundFont parameter: ${parameterId}`);
  }
}

export function soundFontInitializationCommands(parameters: SoundFontParameterValues): string[] {
  return [
    ...soundFontSelectionCommands(parameters.bank, parameters.program),
    ...["gain", "reverb-room", "reverb-damping", "reverb-width", "reverb-send"].flatMap((parameterId) =>
      soundFontParameterCommands(parameterId, parameters[parameterId as keyof SoundFontParameterValues], parameters)),
  ];
}

function soundFontSelectionCommands(bank: number, program: number): string[] {
  return performanceChannels.map((channel) => `select ${channel} 1 ${Math.round(bank)} ${Math.round(program)}`);
}

export function fluidSynthArguments(deviceId: string, soundFontPath: string, gain: number, percussionSoundFontPath?: string | null): string[] {
  const args = [
    "-q",
    "-a", "alsa",
    "-o", `audio.alsa.device=${deviceId}`,
    "-r", "48000",
    "-z", "512",
    "-c", "2",
    "-o", "midi.autoconnect=0",
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
  const note = accent ? 76 : 77;
  const velocity = Math.max(1, Math.min(127, Math.round(Math.sqrt(volume) * 127)));
  return { noteOn: `noteon 15 ${note} ${velocity}`, noteOff: `noteoff 15 ${note}` };
}

export function drumCommands(note: number, velocity: number): { noteOn: string; noteOff: string } {
  const safeNote = Math.max(0, Math.min(127, Math.round(note)));
  const safeVelocity = Math.max(1, Math.min(127, Math.round(velocity)));
  return { noteOn: `noteon 9 ${safeNote} ${safeVelocity}`, noteOff: `noteoff 9 ${safeNote}` };
}

export function auxiliaryPercussionSelectionCommands(hasAuxiliarySoundFont: boolean): string[] {
  // FluidSynth uses SoundFont bank 128 for General MIDI percussion presets.
  const soundFontId = hasAuxiliarySoundFont ? 2 : 1;
  return [`select 9 ${soundFontId} 128 0`, `select 15 ${soundFontId} 128 0`];
}
