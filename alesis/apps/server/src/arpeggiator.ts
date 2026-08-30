import { Midi, Note } from "@tonaljs/tonal";
import type { MidiEvent } from "@alesis/engine";

export type ArpeggiatorMode = "up" | "down" | "up-down" | "played" | "random";
export type ArpeggiatorRate = "1/4" | "1/8" | "1/16" | "1/8T" | "1/16T";

export interface ArpeggiatorConfig {
  enabled: boolean;
  mode: ArpeggiatorMode;
  rate: ArpeggiatorRate;
  octaves: number;
  gate: number;
  latch: boolean;
  swing: number;
}

interface HeldNote {
  channel: number;
  note: number;
  velocity: number;
  order: number;
  physicallyHeld: boolean;
}

const rateBeats: Record<ArpeggiatorRate, number> = {
  "1/4": 1,
  "1/8": 0.5,
  "1/16": 0.25,
  "1/8T": 1 / 3,
  "1/16T": 1 / 6,
};

export class MidiArpeggiator {
  private config: ArpeggiatorConfig;
  private held = new Map<string, HeldNote>();
  private order = 0;
  private step = 0;
  private timeToStep = 0;
  private active: { channel: number; note: number; timeToOff: number } | null = null;

  constructor(config: ArpeggiatorConfig, private readonly random = Math.random) {
    this.config = { ...config };
  }

  configure(config: Partial<ArpeggiatorConfig>): MidiEvent[] {
    const wasLatched = this.config.latch;
    const structuralChange = config.mode !== undefined && config.mode !== this.config.mode
      || config.rate !== undefined && config.rate !== this.config.rate
      || config.octaves !== undefined && config.octaves !== this.config.octaves
      || config.swing !== undefined && config.swing !== this.config.swing;
    this.config = { ...this.config, ...config };
    if (wasLatched && !this.config.latch) {
      for (const [key, note] of this.held) if (!note.physicallyHeld) this.held.delete(key);
    }
    if (!this.config.enabled) {
      this.held.clear();
      return this.flush();
    }
    if (structuralChange || wasLatched && !this.config.latch) return this.flush();
    return [];
  }

  handle(event: MidiEvent): MidiEvent[] {
    if (!this.config.enabled) return [event];
    if (event.type !== "note-on" && event.type !== "note-off") return [event];
    if (!Number.isInteger(event.note) || event.note < 0 || event.note > 127) return [];
    const key = `${event.channel}:${event.note}`;
    if (event.type === "note-on" && event.velocity > 0) {
      this.held.set(key, { channel: event.channel, note: event.note, velocity: event.velocity, order: this.order++, physicallyHeld: true });
      if (this.held.size === 1) this.timeToStep = 0;
    } else {
      const note = this.held.get(key);
      if (note && this.config.latch) note.physicallyHeld = false;
      else this.held.delete(key);
    }
    return [];
  }

  advance(seconds: number, bpm: number): MidiEvent[] {
    if (!this.config.enabled) return [];
    const events: MidiEvent[] = [];
    let remaining = seconds;
    while (remaining >= 0) {
      const nextOff = this.active?.timeToOff ?? Number.POSITIVE_INFINITY;
      const nextStep = this.held.size > 0 ? this.timeToStep : Number.POSITIVE_INFINITY;
      const elapsed = Math.min(nextOff, nextStep, remaining);
      if (!Number.isFinite(elapsed)) break;
      if (this.active) this.active.timeToOff -= elapsed;
      this.timeToStep -= elapsed;
      remaining -= elapsed;

      if (this.active && this.active.timeToOff <= 1e-9) {
        events.push({ type: "note-off", channel: this.active.channel, note: this.active.note });
        this.active = null;
      }
      if (this.held.size > 0 && this.timeToStep <= 1e-9) {
        if (this.active) {
          events.push({ type: "note-off", channel: this.active.channel, note: this.active.note });
          this.active = null;
        }
        const note = this.nextNote();
        if (note) {
          events.push({ type: "note-on", channel: note.channel, note: note.note, velocity: note.velocity });
          const interval = this.stepDuration(bpm);
          this.active = { channel: note.channel, note: note.note, timeToOff: interval * this.config.gate };
          this.timeToStep = interval;
          this.step += 1;
        }
      }
      if (elapsed === remaining && remaining === 0) break;
      if (elapsed === 0 && this.timeToStep > 0 && (!this.active || this.active.timeToOff > 0)) break;
    }
    return events;
  }

  flush(): MidiEvent[] {
    const events = this.active ? [{ type: "note-off" as const, channel: this.active.channel, note: this.active.note }] : [];
    this.active = null;
    this.resetSequence();
    return events;
  }

  private nextNote(): HeldNote | null {
    const expanded = this.expandedNotes();
    if (expanded.length === 0) return null;
    if (this.config.mode === "random") return expanded[Math.floor(this.random() * expanded.length)] ?? expanded[0]!;
    const sequence = this.config.mode === "down"
      ? [...expanded].reverse()
      : this.config.mode === "up-down" && expanded.length > 1
        ? [...expanded, ...expanded.slice(1, -1).reverse()]
        : expanded;
    return sequence[this.step % sequence.length]!;
  }

  private expandedNotes(): HeldNote[] {
    const notes = [...this.held.values()];
    const base = this.config.mode === "played" ? notes.sort((left, right) => left.order - right.order) : notes.sort((left, right) => left.note - right.note);
    return Array.from({ length: this.config.octaves }, (_, octave) => base.map((note) => ({ ...note, note: transposeMidi(note.note, octave) }))).flat();
  }

  private stepDuration(bpm: number): number {
    const base = 60 / bpm * rateBeats[this.config.rate];
    return base * (this.step % 2 === 0 ? 1 + this.config.swing : 1 - this.config.swing);
  }

  private resetSequence(): void {
    this.step = 0;
    this.timeToStep = 0;
  }
}

function transposeMidi(midi: number, octaves: number): number {
  const noteName = Midi.midiToNoteName(midi);
  if (octaves === 0) return midi;
  const transposed = Midi.toMidi(Note.transpose(noteName, `${octaves * 7 + 1}P`)) ?? midi + octaves * 12;
  return Math.max(0, Math.min(127, transposed));
}
