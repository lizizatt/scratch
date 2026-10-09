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
  private readonly sustainedChannels = new Set<number>();
  private lastNoteChannel: number | null = null;
  private sustainValue: number | null = null;
  private bendValue: number | null = null;
  private readonly bentChannels = new Map<number, number>();

  route(event: MidiEvent): MidiEvent[] {
    if (event.type === "note-on" && event.velocity > 0) {
      this.heldNotes.set(`${event.channel}:${event.note}`, event.channel);
      this.lastNoteChannel = event.channel;
      // A note starting on a channel that hasn't seen the currently held sustain/bend
      // must be caught up first, or it sounds unbent/undamped next to notes that have.
      const catchUp: MidiEvent[] = [];
      if (this.sustainValue !== null && !this.sustainedChannels.has(event.channel)) {
        this.sustainedChannels.add(event.channel);
        catchUp.push({ type: "control-change", channel: event.channel, controller: 64, value: this.sustainValue });
      }
      if (this.bendValue !== null && this.bentChannels.get(event.channel) !== this.bendValue) {
        this.bentChannels.set(event.channel, this.bendValue);
        catchUp.push({ type: "pitch-bend", channel: event.channel, value: this.bendValue });
      }
      if (catchUp.length > 0) return [...catchUp, event];
    } else if (event.type === "note-off" || event.type === "note-on" && event.velocity === 0) {
      this.heldNotes.delete(`${event.channel}:${event.note}`);
    }
    if (event.type === "control-change" && event.controller === 64) return this.routeSustain(event);
    if (event.type !== "pitch-bend") return [event];
    if (event.value === 0 && this.bentChannels.size > 0) {
      const channels = [...this.bentChannels.keys()];
      this.bentChannels.clear();
      this.bendValue = null;
      return channels.map((channel) => ({ ...event, channel }));
    }
    const routed = this.routeGlobalControl(event);
    if (event.value !== 0) {
      this.bendValue = event.value;
      for (const routedEvent of routed) this.bentChannels.set(routedEvent.channel, event.value);
    }
    return routed;
  }

  private routeSustain(event: Extract<MidiEvent, { type: "control-change" }>): MidiEvent[] {
    const pressed = event.value >= 64;
    const channels = new Set(this.sustainedChannels);
    for (const channel of this.targetChannels(event.channel)) channels.add(channel);
    this.sustainValue = pressed ? event.value : null;
    if (pressed) {
      for (const channel of channels) this.sustainedChannels.add(channel);
    } else {
      this.sustainedChannels.clear();
    }
    return [...channels].map((channel) => ({ ...event, channel }));
  }

  private routeGlobalControl<T extends MidiEvent>(event: T): T[] {
    return this.targetChannels(event.channel).map((channel) => ({ ...event, channel }));
  }

  private targetChannels(fallbackChannel: number): number[] {
    const channels = [...new Set(this.heldNotes.values())];
    if (channels.length === 0 && this.lastNoteChannel !== null) channels.push(this.lastNoteChannel);
    return channels.length > 0 ? channels : [fallbackChannel];
  }

  panic(): void {
    this.heldNotes.clear();
    this.sustainedChannels.clear();
    this.lastNoteChannel = null;
    this.sustainValue = null;
    this.bendValue = null;
    this.bentChannels.clear();
  }
}
