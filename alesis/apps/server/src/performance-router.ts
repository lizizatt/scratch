import type { MidiEvent } from "@alesis/engine";
import type { VelocityCurve } from "@alesis/protocol";

export function applyVelocityCurve(event: MidiEvent, curve: VelocityCurve): MidiEvent {
  if (event.type !== "note-on" || event.velocity === 0 || curve === "linear") return event;
  const velocity = curve === "fixed"
    ? 127
    : curve === "strong"
      ? Math.round(event.velocity * 1.5 + 10)
      : Math.round(event.velocity * 1.35);
  return { ...event, velocity: Math.max(1, Math.min(127, velocity)) };
}

export class PerformanceRouter {
  private readonly heldNotes = new Map<string, number>();
  private lastNoteChannel: number | null = null;

  route(event: MidiEvent): MidiEvent[] {
    if (event.type === "note-on" && event.velocity > 0) {
      this.heldNotes.set(`${event.channel}:${event.note}`, event.channel);
      this.lastNoteChannel = event.channel;
    } else if (event.type === "note-off" || event.type === "note-on" && event.velocity === 0) {
      this.heldNotes.delete(`${event.channel}:${event.note}`);
    }
    if (event.type !== "pitch-bend") return [event];
    const channels = [...new Set(this.heldNotes.values())];
    if (channels.length === 0 && this.lastNoteChannel !== null) channels.push(this.lastNoteChannel);
    return channels.length > 0 ? channels.map((channel) => ({ ...event, channel })) : [event];
  }

  panic(): void {
    this.heldNotes.clear();
    this.lastNoteChannel = null;
  }
}
