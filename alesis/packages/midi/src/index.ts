import type { MidiEvent } from "@alesis/engine";
import { Input } from "@julusian/midi/lazy";
import { createReadStream, existsSync, readFileSync, readdirSync, type ReadStream } from "node:fs";
import { basename, join } from "node:path";

export type MidiListener = (event: MidiEvent) => void;

export interface MidiSource {
  readonly id: string;
  readonly name: string;
  subscribe(listener: MidiListener): () => void;
  start(): Promise<void>;
  close(): Promise<void>;
}

type ControlIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type SoftwareControl = "touch-strip" | "accelerometer" | "sustain" | `fader-${ControlIndex}` | `pad-${ControlIndex}`;

// Vortex presets are remappable; keep preset-specific assignments outside normalized events.
export const SOFTWARE_VORTEX_PROFILE: Readonly<Record<SoftwareControl, number>> = {
  "touch-strip": 5,
  "accelerometer": 1,
  "sustain": 64,
  "fader-1": 21,
  "fader-2": 22,
  "fader-3": 23,
  "fader-4": 24,
  "fader-5": 25,
  "fader-6": 26,
  "fader-7": 27,
  "fader-8": 28,
  "pad-1": 36,
  "pad-2": 37,
  "pad-3": 38,
  "pad-4": 39,
  "pad-5": 40,
  "pad-6": 41,
  "pad-7": 42,
  "pad-8": 43,
};

export class SoftwareVortex implements MidiSource {
  readonly id = "software-vortex";
  readonly name = "Software Vortex";
  private listeners = new Set<MidiListener>();

  subscribe(listener: MidiListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.listeners.clear();
  }

  keyDown(note: number, velocity = 100, channel = 0): void {
    this.emit({ type: "note-on", channel: midiChannel(channel), note: dataByte(note), velocity: dataByte(velocity) });
  }

  keyUp(note: number, channel = 0): void {
    this.emit({ type: "note-off", channel: midiChannel(channel), note: dataByte(note) });
  }

  pitchBend(value: number, channel = 0): void {
    this.emit({ type: "pitch-bend", channel: midiChannel(channel), value: Math.max(-1, Math.min(1, value)) });
  }

  pressure(value: number, channel = 0): void {
    this.emit({ type: "channel-pressure", channel: midiChannel(channel), value: dataByte(value) });
  }

  control(control: SoftwareControl, value: number, channel = 0): void {
    const controller = SOFTWARE_VORTEX_PROFILE[control];
    this.emit({ type: "control-change", channel: midiChannel(channel), controller, value: dataByte(value) });
  }

  private emit(event: MidiEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

export const VORTEX_WIRELESS_2_USB_ID = "13b2:005f";

export interface AlsaMidiDevice {
  id: string;
  name: string;
  path: string;
  usbId: string;
}

export interface AlsaSequencerPort {
  id: string;
  name: string;
  portName: string;
}

export function selectVortexSequencerPort(portNames: readonly string[]): AlsaSequencerPort | null {
  const portName = portNames.find((name) => name.toLowerCase().includes("vortex wireless 2"));
  if (!portName) return null;
  const address = portName.match(/(\d+:\d+)$/)?.[1];
  return { id: `alsa-seq:${address ?? portName}`, name: "Vortex Wireless 2", portName };
}

export function discoverVortexSequencerPort(): AlsaSequencerPort | null {
  try {
    return selectVortexSequencerPort(Input.getPortNames());
  } catch {
    return null;
  }
}

export class AlsaSequencerMidiSource implements MidiSource {
  readonly id: string;
  readonly name: string;
  private listeners = new Set<MidiListener>();
  private input: Input | null = null;

  constructor(private readonly port: AlsaSequencerPort) {
    this.id = port.id;
    this.name = port.name;
  }

  subscribe(listener: MidiListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.input) return;
    const input = new Input();
    input.ignoreTypes(true, false, true);
    input.on("message", (_deltaTime, message) => {
      const event = decodeMidiMessage(message);
      if (event) this.listeners.forEach((listener) => listener(event));
    });
    input.openPortByName(this.port.portName);
    if (!input.isPortOpen()) {
      input.destroy();
      throw new Error(`Unable to open MIDI sequencer port: ${this.port.portName}`);
    }
    this.input = input;
  }

  async close(): Promise<void> {
    const input = this.input;
    this.input = null;
    this.listeners.clear();
    if (!input) return;
    input.closePort();
    input.destroy();
  }
}

export function discoverVortexDevice(asoundRoot = "/proc/asound", deviceRoot = "/dev/snd"): AlsaMidiDevice | null {
  if (!existsSync(asoundRoot)) return null;
  for (const entry of readdirSync(asoundRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^card\d+$/.test(entry.name)) continue;
    const cardDirectory = join(asoundRoot, entry.name);
    const usbIdPath = join(cardDirectory, "usbid");
    const midiInfoPath = join(cardDirectory, "midi0");
    if (!existsSync(usbIdPath) || !existsSync(midiInfoPath)) continue;
    const usbId = readFileSync(usbIdPath, "utf8").trim().toLowerCase();
    if (usbId !== VORTEX_WIRELESS_2_USB_ID) continue;
    const cardNumber = entry.name.slice(4);
    const path = join(deviceRoot, `midiC${cardNumber}D0`);
    if (!existsSync(path)) continue;
    const name = readFileSync(midiInfoPath, "utf8").split("\n", 1)[0]?.trim() || "Vortex Wireless 2";
    return { id: `alsa:${basename(path)}`, name, path, usbId };
  }
  return null;
}

export class AlsaRawMidiSource implements MidiSource {
  readonly id: string;
  readonly name: string;
  private listeners = new Set<MidiListener>();
  private stream: ReadStream | null = null;
  private decoder: MidiByteStreamDecoder;

  constructor(private readonly device: AlsaMidiDevice) {
    this.id = device.id;
    this.name = device.name;
    this.decoder = new MidiByteStreamDecoder((event) => this.listeners.forEach((listener) => listener(event)));
  }

  subscribe(listener: MidiListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.stream) return;
    const stream = createReadStream(this.device.path, { highWaterMark: 256 });
    await new Promise<void>((resolve, reject) => {
      stream.once("open", () => resolve());
      stream.once("error", reject);
    });
    stream.on("data", (chunk) => {
      if (typeof chunk !== "string") this.decoder.push(chunk);
    });
    stream.on("error", (error) => console.error(`Vortex MIDI input failed: ${error.message}`));
    this.stream = stream;
  }

  async close(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    this.listeners.clear();
    if (!stream) return;
    await new Promise<void>((resolve) => {
      stream.once("close", resolve);
      stream.destroy();
    });
  }
}

export class MidiByteStreamDecoder {
  private runningStatus: number | null = null;
  private status: number | null = null;
  private data: number[] = [];
  private inSysEx = false;

  constructor(private readonly emit: MidiListener) {}

  push(bytes: Iterable<number>): void {
    for (const byte of bytes) this.pushByte(byte);
  }

  private pushByte(rawByte: number): void {
    const byte = rawByte & 0xff;
    if (byte >= 0xf8) return;
    if (this.inSysEx) {
      if (byte === 0xf7) this.inSysEx = false;
      return;
    }
    if (byte >= 0x80) {
      if (byte === 0xf0) {
        this.inSysEx = true;
        this.runningStatus = null;
        this.resetMessage();
        return;
      }
      if (byte >= 0xf0) {
        this.runningStatus = null;
        this.resetMessage();
        return;
      }
      this.status = byte;
      this.runningStatus = byte;
      this.data = [];
      return;
    }

    if (this.status === null) this.status = this.runningStatus;
    if (this.status === null) return;
    this.data.push(byte);
    const expected = messageDataLength(this.status);
    if (expected === null) {
      this.resetMessage();
      return;
    }
    if (this.data.length < expected) return;
    const event = decodeMidiMessage([this.status, ...this.data]);
    if (event) this.emit(event);
    this.status = this.runningStatus;
    this.data = [];
  }

  private resetMessage(): void {
    this.status = null;
    this.data = [];
  }
}

export function decodeMidiMessage(bytes: readonly number[]): MidiEvent | null {
  const status = bytes[0];
  if (status === undefined || status < 0x80 || status >= 0xf0) return null;
  const type = status & 0xf0;
  const channel = status & 0x0f;
  const first = bytes[1];
  const second = bytes[2];

  if (type === 0x90 && first !== undefined && second !== undefined) {
    return second === 0
      ? { type: "note-off", channel, note: dataByte(first) }
      : { type: "note-on", channel, note: dataByte(first), velocity: dataByte(second) };
  }
  if (type === 0x80 && first !== undefined) return { type: "note-off", channel, note: dataByte(first) };
  if (type === 0xb0 && first !== undefined && second !== undefined) return { type: "control-change", channel, controller: dataByte(first), value: dataByte(second) };
  if (type === 0xd0 && first !== undefined) return { type: "channel-pressure", channel, value: dataByte(first) };
  if (type === 0xe0 && first !== undefined && second !== undefined) {
    const raw = (dataByte(second) << 7) | dataByte(first);
    return { type: "pitch-bend", channel, value: Math.max(-1, (raw - 8192) / 8192) };
  }
  return null;
}

function dataByte(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}

function midiChannel(value: number): number {
  return Math.max(0, Math.min(15, Math.round(value)));
}

function messageDataLength(status: number): number | null {
  const type = status & 0xf0;
  if (type === 0xc0 || type === 0xd0) return 1;
  if (type >= 0x80 && type <= 0xe0) return 2;
  return null;
}
