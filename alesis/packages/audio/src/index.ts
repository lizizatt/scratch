import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import type { MidiEvent } from "@alesis/engine";

export interface AudioOutput {
  readonly id: string;
  readonly name: string;
  start(): Promise<void>;
  dispatchMidi(event: MidiEvent): void;
  playMetronome(accent: boolean, volume: number): void;
  close(): Promise<void>;
}

export interface PulseAudioDevice {
  id: string;
  name: string;
}

export interface FluidSynthOptions {
  device: PulseAudioDevice;
  soundFontPath?: string;
  gain?: number;
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

export class SilentAudioOutput implements AudioOutput {
  readonly id = "simulated-output";
  readonly name = "Simulated output";
  async start(): Promise<void> {}
  dispatchMidi(): void {}
  playMetronome(): void {}
  async close(): Promise<void> {}
}

export class FluidSynthOutput implements AudioOutput {
  readonly id: string;
  readonly name: string;
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly soundFontPath: string;
  private readonly gain: number;
  private clickTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly options: FluidSynthOptions) {
    this.id = `pulse:${options.device.id}`;
    this.name = options.device.name;
    this.soundFontPath = options.soundFontPath ?? "/usr/share/sounds/sf2/FluidR3_GM.sf2";
    this.gain = options.gain ?? 0.6;
  }

  async start(): Promise<void> {
    if (this.process) return;
    if (!existsSync(this.soundFontPath)) throw new Error(`SoundFont not found: ${this.soundFontPath}`);
    const child = spawn("fluidsynth", fluidSynthArguments(this.options.device.id, this.soundFontPath, this.gain), {
      stdio: fluidSynthStdio,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.once("exit", () => {
      if (this.process === child) this.process = null;
    });
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message && !message.includes("Failed to set thread to high priority")) console.error(message);
    });
    this.process = child;
    await waitForFluidSynthShell(child.stdin, child.stdout);
    drainFluidSynthStdout(child.stdout);
    this.writeCommand("prog 0 0");
  }

  dispatchMidi(event: MidiEvent): void {
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

  async close(): Promise<void> {
    const child = this.process;
    this.process = null;
    for (const timer of this.clickTimers) clearTimeout(timer);
    this.clickTimers.clear();
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.stdin.end("quit\n");
    });
  }

  private writeCommand(command: string): void {
    if (this.process?.stdin.writable) this.process.stdin.write(`${command}\n`);
  }
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

export function fluidSynthArguments(deviceId: string, soundFontPath: string, gain: number): string[] {
  return [
    "-q",
    "-a", "pulseaudio",
    "-o", `audio.pulseaudio.device=${deviceId}`,
    "-o", `synth.gain=${gain}`,
    soundFontPath,
  ];
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
  const velocity = Math.max(1, Math.min(127, Math.round(volume * 127)));
  return { noteOn: `noteon 9 ${note} ${velocity}`, noteOff: `noteoff 9 ${note}` };
}
