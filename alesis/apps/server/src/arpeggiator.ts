import { Midi, Note } from "@tonaljs/tonal";
import type { MidiEvent } from "@alesis/engine";

export type ArpeggiatorMode = "up" | "down" | "up-down" | "up-to-root-then-down" | "played" | "random";
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

export interface ScheduledMidiEvent {
  event: MidiEvent;
  delaySeconds: number;
}

export const rateBeats: Record<ArpeggiatorRate, number> = {
  "1/4": 1,
  "1/8": 0.5,
  "1/16": 0.25,
  "1/8T": 1 / 3,
  "1/16T": 1 / 6,
};
const idleResetSeconds = 0.5;

export class MidiArpeggiator {
  private config: ArpeggiatorConfig;
  private held = new Map<string, HeldNote>();
  private order = 0;
  private step = 0;
  private timeToStep = 0;
  private active: { channel: number; note: number; timeToOff: number } | null = null;
  private idleSeconds: number | null = null;

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
      this.idleSeconds = null;
      if (this.held.size === 1) this.timeToStep = 0;
    } else {
      const note = this.held.get(key);
      if (note && this.config.latch) note.physicallyHeld = false;
      else this.held.delete(key);
      if (this.held.size === 0) this.idleSeconds = 0;
    }
    return [];
  }

  advance(seconds: number, bpm: number): MidiEvent[] {
    return this.advanceScheduled(seconds, bpm).map(({ event }) => event);
  }

  advanceScheduled(seconds: number, bpm: number): ScheduledMidiEvent[] {
    if (!this.config.enabled) return [];
    this.advanceIdle(seconds);
    const events: ScheduledMidiEvent[] = [];
    let remaining = seconds;
    while (remaining >= 0) {
      const eventCount = events.length;
      const nextOff = this.active?.timeToOff ?? Number.POSITIVE_INFINITY;
      const nextStep = this.held.size > 0 ? this.timeToStep : Number.POSITIVE_INFINITY;
      const elapsed = Math.min(nextOff, nextStep, remaining);
      if (!Number.isFinite(elapsed)) break;
      if (this.active) this.active.timeToOff -= elapsed;
      this.timeToStep -= elapsed;
      remaining -= elapsed;

      if (this.active && this.active.timeToOff <= 1e-9) {
        for (const event of this.releaseStep()) events.push({ event, delaySeconds: seconds - remaining });
      }
      if (this.held.size > 0 && this.timeToStep <= 1e-9) {
        for (const event of this.stepNow(this.stepDuration(bpm))) {
          events.push({ event, delaySeconds: seconds - remaining });
        }
      }
      if (elapsed === remaining && remaining === 0) break;
      if (elapsed === 0 && events.length === eventCount) break;
    }
    return events;
  }

  get hasHeldNotes(): boolean {
    return this.held.size > 0;
  }

  /** Advance only the idle reset, without selecting any future notes. */
  advanceIdle(seconds: number): void {
    if (this.idleSeconds !== null) {
      this.idleSeconds += seconds;
      if (this.idleSeconds >= idleResetSeconds - 1e-9) {
        this.resetSequence();
        this.idleSeconds = null;
      }
    }
  }

  /** Select from the current chord at a delivered deadline; the caller owns gate timing. */
  stepNow(intervalSeconds: number): MidiEvent[] {
    if (!this.config.enabled) return [];
    const events = this.releaseStep();
    const note = this.nextNote();
    if (note) {
      events.push({ type: "note-on", channel: note.channel, note: note.note, velocity: note.velocity });
      this.active = { channel: note.channel, note: note.note, timeToOff: intervalSeconds * this.config.gate };
      this.timeToStep = intervalSeconds;
      this.step += 1;
    }
    return events;
  }

  releaseStep(): MidiEvent[] {
    const events = this.active ? [{ type: "note-off" as const, channel: this.active.channel, note: this.active.note }] : [];
    this.active = null;
    return events;
  }

  flush(): MidiEvent[] {
    const events = this.releaseStep();
    this.resetSequence();
    return events;
  }

  panic(): MidiEvent[] {
    this.held.clear();
    return this.flush();
  }

  private nextNote(): HeldNote | null {
    const expanded = this.expandedNotes();
    if (expanded.length === 0) return null;
    if (this.config.mode === "random") return expanded[Math.floor(this.random() * expanded.length)] ?? expanded[0]!;
    const sequence = this.config.mode === "down"
      ? [...expanded].reverse()
      : this.config.mode === "up-down" && expanded.length > 1
        ? [...expanded, ...expanded.slice(1, -1).reverse()]
        : this.config.mode === "up-to-root-then-down"
          ? this.upToRootThenDown(expanded)
        : expanded;
    return sequence[this.step % sequence.length]!;
  }

  private upToRootThenDown(expanded: HeldNote[]): HeldNote[] {
    const lowest = expanded[0];
    if (!lowest) return [];
    const upperRoot = { ...lowest, note: transposeMidi(lowest.note, this.config.octaves) };
    const seen = new Set<number>();
    const ascent = expanded.filter(({ note }) => {
      if (note > upperRoot.note || seen.has(note)) return false;
      seen.add(note);
      return true;
    });
    if (!seen.has(upperRoot.note)) ascent.push(upperRoot);
    return [...ascent, ...ascent.slice(1, -1).reverse()];
  }

  private expandedNotes(): HeldNote[] {
    const notes = [...this.held.values()];
    const base = this.config.mode === "played" ? notes.sort((left, right) => left.order - right.order) : notes.sort((left, right) => left.note - right.note);
    return Array.from({ length: this.config.octaves }, (_, octave) => base.map((note) => ({ ...note, note: transposeMidi(note.note, octave) }))).flat();
  }

  stepDuration(bpm: number): number {
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
