import type { MidiEvent } from "@alesis/engine";

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
}
