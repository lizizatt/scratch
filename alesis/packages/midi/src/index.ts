import type { MidiEvent } from "@alesis/engine";

export type MidiListener = (event: MidiEvent) => void;

export interface MidiSource {
  subscribe(listener: MidiListener): () => void;
}

type ControlIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type SoftwareControl = "touch-strip" | "accelerometer" | "sustain" | `fader-${ControlIndex}` | `pad-${ControlIndex}`;

// Development assignments only. The Vortex editor can remap these, so physical-device
// capture will replace this profile rather than changing normalized engine events.
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
  private listeners = new Set<MidiListener>();

  subscribe(listener: MidiListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
