import type { EditableNote, MidiEvent } from "@alesis/protocol";
import { pairRecording } from "./circular-recording.js";
import type { RecordedMidiEvent } from "./loop-playback.js";

/** Shortest editable note and nearest distinct same-key attacks, as a fraction of the loop. */
export const MIN_NOTE_DURATION = 1e-4;

const noteOn = (event: MidiEvent): event is Extract<MidiEvent, { type: "note-on" }> => event.type === "note-on" && event.velocity > 0;

/** Pairs a take's attacks with their releases; controllers are not notes and stay out. */
export function notesFromRecording(recording: readonly RecordedMidiEvent[]): EditableNote[] {
  return pairRecording(recording).notes
    .flatMap(({ on, off }) => noteOn(on.event) ? [{ event: on.event, start: on.position, duration: off.position - on.position }] : [])
    .sort((a, b) => a.start - b.start || a.event.channel - b.event.channel || a.event.note - b.event.note)
    .map(({ event, start, duration }, id) => ({
      id, channel: event.channel, note: event.note, velocity: event.velocity,
      start: start >= 1 ? 0 : start,
      duration: Math.min(1, Math.max(MIN_NOTE_DURATION, duration)),
    }));
}

/**
 * Notes that share a channel and key cannot overlap, circularly: an earlier note is cut where the next
 * begins, and of two attacks closer than the minimum only the later survives.
 */
export function normalizeNotes(notes: readonly EditableNote[]): EditableNote[] {
  const groups = new Map<string, EditableNote[]>();
  for (const note of notes) {
    const key = `${note.channel}:${note.note}`;
    groups.set(key, [...groups.get(key) ?? [], note]);
  }
  const result: EditableNote[] = [];
  for (const group of groups.values()) {
    const kept: EditableNote[] = [];
    for (const note of [...group].sort((a, b) => a.start - b.start)) {
      if (kept.length > 0 && note.start - kept.at(-1)!.start < MIN_NOTE_DURATION) kept.pop();
      kept.push(note);
    }
    if (kept.length > 1 && kept[0]!.start + 1 - kept.at(-1)!.start < MIN_NOTE_DURATION) kept.pop();
    kept.forEach((note, index) => {
      const following = kept[(index + 1) % kept.length]!;
      const room = kept.length === 1 ? 1 : index === kept.length - 1 ? following.start + 1 - note.start : following.start - note.start;
      result.push({ ...note, duration: Math.min(Math.max(note.duration, MIN_NOTE_DURATION), room, 1) });
    });
  }
  return result.sort((a, b) => a.start - b.start || a.channel - b.channel || a.note - b.note);
}

/**
 * Rebuilds a take around edited notes. Controllers keep their recorded positions; ties between a
 * controller and a note event keep the controller first, and releases precede attacks.
 */
export function recordingFromNotes(notes: readonly EditableNote[], previous: readonly RecordedMidiEvent[]): RecordedMidiEvent[] {
  const originalOrder = new Map(previous.map((item, index) => [item, index]));
  const items: Array<{ item: RecordedMidiEvent; order: number }> = pairRecording(previous).controls
    .map((item) => ({ item: structuredClone(item), order: originalOrder.get(item) ?? 0 }));
  let order = previous.length;
  const add = (position: number, event: MidiEvent, continuation = false): void => {
    items.push({ item: { position, event, ...(continuation ? { continuation: true as const } : {}) }, order: order++ });
  };
  for (const { channel, note, velocity, start, duration } of notes) {
    const attack: MidiEvent = { type: "note-on", channel, note, velocity };
    const release: MidiEvent = { type: "note-off", channel, note };
    const end = start + duration;
    add(start, attack);
    if (end <= 1 + 1e-9) add(Math.min(1, end), release);
    else {
      add(1, release);
      add(0, structuredClone(attack), true);
      add(end - 1, structuredClone(release));
    }
  }
  const rank = ({ item }: { item: RecordedMidiEvent }): number => noteOn(item.event) ? 1 : 0;
  return items
    .sort((a, b) => a.item.position - b.item.position || rank(a) - rank(b) || a.order - b.order)
    .map(({ item }) => item);
}
