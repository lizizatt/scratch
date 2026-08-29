import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MidiEvent } from "@alesis/engine";

export interface SoundFontRenderParameters {
  bank?: number;
  program?: number;
  gain?: number;
  chorus?: number;
  reverb?: number;
}

export interface NeonPressureParameters {
  cutoff: number;
  resonance: number;
  attack: number;
  release: number;
  "lfo-rate": number;
  drive: number;
}

interface NeonVoice {
  channel: number;
  note: number;
  velocity: number;
  phase: number;
  envelope: number;
  released: boolean;
}

const neonDefaults: NeonPressureParameters = {
  cutoff: 6_300,
  resonance: 0.42,
  attack: 0.024,
  release: 1.8,
  "lfo-rate": 3.2,
  drive: 0.18,
};

export class NeonPressureSynth {
  private readonly parameters: NeonPressureParameters;
  private readonly voices = new Map<string, NeonVoice>();
  private readonly pitchBend = new Map<number, number>();
  private sampleIndex = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(private readonly sampleRate = 48_000, parameters: Partial<NeonPressureParameters> = {}) {
    this.parameters = { ...neonDefaults, ...parameters };
  }

  setParameter(parameterId: keyof NeonPressureParameters, value: number): void {
    this.parameters[parameterId] = value;
  }

  dispatchMidi(event: MidiEvent): void {
    if (event.type === "note-on" && event.velocity > 0) {
      this.voices.set(`${event.channel}:${event.note}`, {
        channel: event.channel,
        note: event.note,
        velocity: event.velocity / 127,
        phase: 0,
        envelope: 0,
        released: false,
      });
    } else if (event.type === "note-off" || (event.type === "note-on" && event.velocity === 0)) {
      const voice = this.voices.get(`${event.channel}:${event.note}`);
      if (voice) voice.released = true;
    } else if (event.type === "pitch-bend") {
      this.pitchBend.set(event.channel, event.value);
    }
  }

  render(frameCount: number): Float32Array {
    const output = new Float32Array(frameCount * 2);
    const filter = lowPassCoefficients(this.parameters.cutoff, this.parameters.resonance, this.sampleRate);
    const attackStep = 1 / Math.max(1, this.parameters.attack * this.sampleRate);
    const releaseStep = 1 / Math.max(1, this.parameters.release * this.sampleRate);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = this.sampleIndex / this.sampleRate;
      const lfo = Math.sin(2 * Math.PI * this.parameters["lfo-rate"] * time) * 0.35;
      let mixed = 0;
      for (const [key, voice] of this.voices) {
        if (voice.released) voice.envelope = Math.max(0, voice.envelope - releaseStep);
        else voice.envelope = Math.min(1, voice.envelope + attackStep);
        if (voice.envelope === 0 && voice.released) {
          this.voices.delete(key);
          continue;
        }
        const semitones = voice.note - 69 + (this.pitchBend.get(voice.channel) ?? 0) * 2 + lfo;
        const frequency = 440 * 2 ** (semitones / 12);
        voice.phase = (voice.phase + frequency / this.sampleRate) % 1;
        mixed += (voice.phase * 2 - 1) * voice.velocity * voice.envelope;
      }
      mixed /= Math.max(1, Math.sqrt(this.voices.size));
      const filtered = filter.b0 * mixed + filter.b1 * this.x1 + filter.b2 * this.x2 - filter.a1 * this.y1 - filter.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = mixed;
      this.y2 = this.y1;
      this.y1 = filtered;
      const driven = applyDrive(filtered, this.parameters.drive) * 0.28;
      output[frame * 2] = driven;
      output[frame * 2 + 1] = driven;
      this.sampleIndex += 1;
    }
    return output;
  }
}

export function renderNeonPressureFixture(parameters: Partial<NeonPressureParameters> = {}): Float32Array {
  const sampleRate = 24_000;
  const synth = new NeonPressureSynth(sampleRate, parameters);
  synth.dispatchMidi({ type: "note-on", channel: 0, note: 60, velocity: 110 });
  const held = synth.render(sampleRate);
  synth.dispatchMidi({ type: "note-off", channel: 0, note: 60 });
  const released = synth.render(sampleRate * 2);
  const samples = new Float32Array(held.length + released.length);
  samples.set(held);
  samples.set(released, held.length);
  return samples;
}

export async function renderSoundFontFixture(soundFontPath: string, parameters: SoundFontRenderParameters = {}): Promise<Float32Array> {
  const values = {
    bank: parameters.bank ?? 0,
    program: parameters.program ?? 0,
    gain: parameters.gain ?? 0.72,
    chorus: parameters.chorus ?? 0.12,
    reverb: parameters.reverb ?? 0.36,
  };
  const directory = await mkdtemp(join(tmpdir(), "alesis-render-"));
  const midiPath = join(directory, "fixture.mid");
  const wavPath = join(directory, "render.wav");
  try {
    await writeFile(midiPath, midiFixture(values.bank, values.program, values.chorus, values.reverb));
    await run("fluidsynth", [
      "-ni", "-F", wavPath, "-r", "48000",
      "-o", "audio.file.format=s16",
      "-o", `synth.gain=${values.gain}`,
      "-o", `synth.chorus.active=${values.chorus > 0 ? 1 : 0}`,
      "-o", `synth.chorus.level=${values.chorus * 10}`,
      "-o", `synth.reverb.active=${values.reverb > 0 ? 1 : 0}`,
      "-o", `synth.reverb.level=${values.reverb}`,
      soundFontPath,
      midiPath,
    ]);
    return decodeWav(await readFile(wavPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function sampleDifference(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let differenceEnergy = 0;
  let referenceEnergy = 0;
  for (let index = 0; index < length; index += 1) {
    differenceEnergy += (left[index]! - right[index]!) ** 2;
    referenceEnergy += Math.max(left[index]! ** 2, right[index]! ** 2);
  }
  return Math.sqrt(differenceEnergy / Math.max(referenceEnergy, Number.EPSILON));
}

function lowPassCoefficients(cutoff: number, resonance: number, sampleRate: number) {
  const frequency = Math.max(20, Math.min(sampleRate * 0.45, cutoff));
  const q = 0.5 + Math.max(0, Math.min(1, resonance)) * 12;
  const omega = 2 * Math.PI * frequency / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  const cos = Math.cos(omega);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: -2 * cos / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyDrive(sample: number, drive: number): number {
  if (drive <= 0) return sample;
  const amount = 1 + drive * 16;
  return Math.tanh(sample * amount) / Math.tanh(amount);
}

function midiFixture(bank: number, program: number, chorus: number, reverb: number): Buffer {
  const track = Buffer.from([
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0xb0, 0x00, Math.round(bank),
    0x00, 0xc0, Math.round(program),
    0x00, 0xb0, 0x5d, Math.round(chorus * 127),
    0x00, 0xb0, 0x5b, Math.round(reverb * 127),
    0x00, 0x90, 0x3c, 0x6e,
    0x83, 0x60, 0x80, 0x3c, 0x00,
    0x87, 0x40, 0xff, 0x2f, 0x00,
  ]);
  const header = Buffer.alloc(14);
  header.write("MThd", 0, "ascii");
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(1, 10);
  header.writeUInt16BE(480, 12);
  const trackHeader = Buffer.alloc(8);
  trackHeader.write("MTrk", 0, "ascii");
  trackHeader.writeUInt32BE(track.length, 4);
  return Buffer.concat([header, trackHeader, track]);
}

function decodeWav(wav: Buffer): Float32Array {
  let offset = 12;
  let format = 0;
  let bitsPerSample = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const chunk = wav.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") {
      format = chunk.readUInt16LE(0);
      bitsPerSample = chunk.readUInt16LE(14);
    } else if (id === "data") {
      data = chunk;
    }
    offset += 8 + size + (size % 2);
  }
  if (!data || format !== 1 || bitsPerSample !== 16) throw new Error(`Unsupported FluidSynth WAV format: format=${format}, bits=${bitsPerSample}`);
  const samples = new Float32Array(data.length / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = data.readInt16LE(index * 2) / 32_768;
  return samples;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => { errorOutput += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${errorOutput.trim()}`)));
  });
}