import type { MidiEvent } from "@alesis/protocol";
import type { RecordedMidiEvent } from "./loop-playback.js";

export const wrapPosition = (position: number): number => ((position % 1) + 1) % 1;
const attack = (event: MidiEvent): event is Extract<MidiEvent, { type: "note-on" }> => event.type === "note-on" && event.velocity > 0;
const release = (event: MidiEvent): boolean => event.type === "note-off" || event.type === "note-on" && event.velocity === 0;
const noteKey = (event: MidiEvent): string => `${event.channel}:${"note" in event ? event.note : ""}`;

export interface NotePair {
  on: RecordedMidiEvent;
  off: RecordedMidiEvent;
  // The physical release stays in source coordinates when a joined gate extends past 1.
  sourceOff?: RecordedMidiEvent;
}

interface SourcedEvent { item: RecordedMidiEvent; source: RecordedMidiEvent; phase?: number }

function sourceOrder(events: SourcedEvent[], recording: readonly RecordedMidiEvent[]): RecordedMidiEvent[] {
  const order = new Map(recording.map((item, index) => [item, index]));
  let position = 0;
  return structuredClone(events.sort((a, b) => comparePosition(a.item, b.item)
    || (a.phase ?? 0) - (b.phase ?? 0)
    || (order.get(a.source) ?? recording.length) - (order.get(b.source) ?? recording.length)).map(({ item }) => {
    // Seam arithmetic can differ by roundoff; persisted timelines must still be monotonic.
    position = Math.max(position, item.position);
    return { ...item, position };
  }));
}

const samePosition = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const comparePosition = (a: RecordedMidiEvent, b: RecordedMidiEvent): number => samePosition(a.position, b.position) ? 0 : a.position - b.position;
function extendPair(pair: NotePair, continuation: NotePair): void {
  const start = pair.off.position;
  const duration = continuation.off.position - continuation.on.position;
  pair.sourceOff = continuation.sourceOff ?? continuation.off;
  // A held key covering an entire cycle is one circular gate, not overlapping voices.
  pair.off = { ...continuation.off, position: Math.min(pair.on.position + 1, start + duration) };
}

/** FIFO ownership preserves repeated attacks and velocity-zero releases. */
export function pairRecording(recording: readonly RecordedMidiEvent[]): { notes: NotePair[]; controls: RecordedMidiEvent[] } {
  const held = new Map<string, RecordedMidiEvent[]>();
  const notes: NotePair[] = [];
  const controls: RecordedMidiEvent[] = [];
  for (const item of [...recording].sort(comparePosition)) {
    const { event } = item;
    if (attack(event)) {
      const queue = held.get(noteKey(event)) ?? [];
      queue.push(item);
      held.set(noteKey(event), queue);
    } else if (release(event)) {
      const on = held.get(noteKey(event))?.shift();
      if (on) notes.push({ on, off: item });
    } else controls.push(item);
  }
  for (const queue of held.values()) for (const on of queue) {
    const event = on.event as Extract<MidiEvent, { type: "note-on" }>;
    notes.push({ on, off: { position: 1, event: { type: "note-off", channel: event.channel, note: event.note } } });
  }
  // A persisted continuation belongs to the terminal segment, not to a new attack.
  for (const continuation of [...notes]) {
    if (!continuation.on.continuation) continue;
    if (!notes.includes(continuation)) continue;
    const previous = notes.find((pair) => pair !== continuation
      && noteKey(pair.on.event) === noteKey(continuation.on.event)
      && ((!pair.on.continuation && samePosition(pair.off.position, continuation.on.position))
        || samePosition(pair.off.position, 1) && continuation.on.position === 0 && pair.on.position > 0));
    if (!previous) continue;
    extendPair(previous, continuation);
    notes.splice(notes.indexOf(continuation), 1);
  }
  return { notes, controls };
}

const controlKey = (event: MidiEvent): string => `${event.channel}:${event.type}:${event.type === "control-change" ? event.controller : ""}`;

/** New attacks never compete with one another; only the previous generation is replaceable. */
export function mergeOverdub(previous: readonly RecordedMidiEvent[], incoming: readonly RecordedMidiEvent[], totalBeats: number): RecordedMidiEvent[] {
  if (incoming.length === 0) return structuredClone(previous) as RecordedMidiEvent[];
  const old = pairRecording(previous);
  const fresh = pairRecording(incoming);
  const continued = new Set<NotePair>();
  for (const continuation of [...fresh.notes]) {
    if (!continuation.on.continuation) continue;
    const preceding = old.notes.find((pair) => !continued.has(pair) && noteKey(pair.on.event) === noteKey(continuation.on.event)
      && (samePosition(wrapPosition(pair.off.position), wrapPosition(continuation.on.position))
        || pair.off.position - pair.on.position >= 1 - 1e-9));
    if (preceding) {
      continued.add(preceding);
      extendPair(preceding, continuation);
      fresh.notes.splice(fresh.notes.indexOf(continuation), 1);
    }
  }
  const available = new Map<string, Set<NotePair>>();
  for (const pair of old.notes) {
    const key = noteKey(pair.on.event);
    if (!available.has(key)) available.set(key, new Set());
    available.get(key)!.add(pair);
  }
  const replaced = new Set<NotePair>();
  for (const pair of fresh.notes.sort((a, b) => a.on.position - b.on.position)) {
    if (pair.on.continuation) continue;
    let nearest: NotePair | undefined;
    let distance = 0.125 / totalBeats + 1e-9;
    for (const candidate of available.get(noteKey(pair.on.event)) ?? []) {
      const delta = Math.abs(pair.on.position - candidate.on.position);
      const circular = Math.min(delta, 1 - delta);
      if (circular < distance) { nearest = candidate; distance = circular; }
    }
    if (nearest) {
      replaced.add(nearest);
      available.get(noteKey(pair.on.event))!.delete(nearest);
    }
  }
  const freshControls = new Set(fresh.controls.map((item) => `${item.position}:${controlKey(item.event)}`));
  // Replace older controller edits, not transitions within the same captured instant.
  const controls = [...old.controls.filter((item) => !freshControls.has(`${item.position}:${controlKey(item.event)}`)), ...fresh.controls];
  return sourceOrder([
    ...controls.map((item) => ({ item, source: item })),
    ...old.notes.filter((pair) => !replaced.has(pair)).flatMap(splitPair),
    ...fresh.notes.flatMap(splitPair),
  ], [...previous, ...incoming]);
}

function splitPair({ on, off, sourceOff = off }: NotePair): SourcedEvent[] {
  if (off.position <= 1) return [{ item: on, source: on }, { item: off, source: sourceOff }];
  return [
    { item: on, source: on },
    { item: { ...off, position: 1 }, source: sourceOff },
    { item: { ...on, position: 0, continuation: true }, source: on, phase: 1 },
    { item: { ...off, position: off.position - 1 }, source: sourceOff },
  ];
}

export function recordingWaveform(recording: readonly RecordedMidiEvent[]): number[] {
  const waveform = Array<number>(96).fill(0);
  for (const { on, off } of pairRecording(recording).notes.flatMap((pair) => {
    const segments = splitPair(pair).map(({ item }) => item);
    return segments.length === 2 ? [pair] : [{ on: segments[0]!, off: segments[1]! }, { on: segments[2]!, off: segments[3]! }];
  })) {
    const velocity = (on.event as Extract<MidiEvent, { type: "note-on" }>).velocity / 127;
    for (let bin = Math.min(95, Math.floor(on.position * 96)); bin <= Math.min(95, Math.floor(off.position * 96)); bin++) {
      waveform[bin] = Math.max(waveform[bin]!, velocity);
    }
  }
  return waveform;
}

/** Source coordinates in; a self-contained one-cycle arrangement at origin out. */
export function rotateRecording(recording: readonly RecordedMidiEvent[], origin: number): RecordedMidiEvent[] {
  if (origin === 0) return structuredClone(recording) as RecordedMidiEvent[];
  const { notes, controls } = pairRecording(recording);
  const result: SourcedEvent[] = [];
  const emit = (source: RecordedMidiEvent, position: number, phase = 0, continuation = source.continuation) => {
    result.push({ item: { ...source, position, ...(continuation ? { continuation } : {}) }, source, phase });
  };
  const state = new Map<string, MidiEvent>();
  const sustainedReleases = new Map<number, Set<RecordedMidiEvent>>();
  // Stable source order decides whether CC64 caught a release at the same time.
  // A later pedal press cannot catch an already released key; a lift ends its hold.
  for (const item of [...recording].sort(comparePosition)) {
    if (item.position > origin && !samePosition(item.position, origin)) break;
    const { event } = item;
    if (event.type === "control-change" && event.controller === 64) {
      if (event.value < 64) sustainedReleases.delete(event.channel);
      else if (!sustainedReleases.has(event.channel)) sustainedReleases.set(event.channel, new Set());
    } else if (release(event)) sustainedReleases.get(event.channel)?.add(item);
  }
  // The source seam has the same neutral controller state as unrotated playback.
  for (const { event } of controls) {
    if (!state.has(controlKey(event))) state.set(controlKey(event), { ...event, value: 0 } as MidiEvent);
  }
  const reset = [...state.values()].filter((event) => !controls.some((item) => item.position === 0 && controlKey(item.event) === controlKey(event)));
  for (const event of reset) emit({ position: 1 - origin, event }, 1 - origin, -1);
  for (const item of controls) {
    if (item.position <= origin || samePosition(item.position, origin)) state.set(controlKey(item.event), item.event);
  }
  for (const event of state.values()) emit({ position: 0, event }, 0, -1);
  for (const item of controls) {
    emit(item, samePosition(item.position, origin) ? 0 : wrapPosition(item.position - origin));
  }
  for (const { on, off, sourceOff = off } of notes) {
    const start = samePosition(on.position, origin) ? 0 : wrapPosition(on.position - origin);
    const duration = Math.max(0, off.position - on.position);
    const end = start + duration;
    emit(on, start);
    emit(sourceOff, Math.min(1, end));
    if (end > 1 + 1e-9 && on.event.channel !== 9) {
      emit(on, 0, 1, true);
      emit(sourceOff, end - 1);
    } else if ((sourceOff.position <= origin || samePosition(sourceOff.position, origin)) && on.event.channel !== 9) {
      // A released key can still sound under the pedal at the selected start.
      if (sustainedReleases.get(on.event.channel)?.has(sourceOff)) {
        emit(on, 0, 1);
        emit(sourceOff, 0, 2);
      }
    }
  }
  return sourceOrder(result, recording);
}