import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import type { MidiEvent } from "@alesis/engine";

export interface AudioOutput {
  readonly id: string;
  readonly name: string;
  start(): Promise<void>;
  dispatchMidi(event: MidiEvent): void;
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

export class SilentAudioOutput implements AudioOutput {
  readonly id = "simulated-output";
  readonly name = "Simulated output";
  async start(): Promise<void> {}
  dispatchMidi(): void {}
  async close(): Promise<void> {}
}

export class FluidSynthOutput implements AudioOutput {
  readonly id: string;
  readonly name: string;
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly soundFontPath: string;
  private readonly gain: number;

  constructor(private readonly options: FluidSynthOptions) {
    this.id = `pulse:${options.device.id}`;
    this.name = options.device.name;
    this.soundFontPath = options.soundFontPath ?? "/usr/share/sounds/sf2/FluidR3_GM.sf2";
    this.gain = options.gain ?? 0.2;
  }

  async start(): Promise<void> {
    if (this.process) return;
    if (!existsSync(this.soundFontPath)) throw new Error(`SoundFont not found: ${this.soundFontPath}`);
    const child = spawn("fluidsynth", fluidSynthArguments(this.options.device.id, this.soundFontPath, this.gain), {
      stdio: ["pipe", "pipe", "pipe"],
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
    child.stdin.write("prog 0 0\n");
  }

  dispatchMidi(event: MidiEvent): void {
    const command = midiEventToFluidCommand(event);
    if (command && this.process?.stdin.writable) this.process.stdin.write(`${command}\n`);
  }

  async close(): Promise<void> {
    const child = this.process;
    this.process = null;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.stdin.end("quit\n");
    });
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
