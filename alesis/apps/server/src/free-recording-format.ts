import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type { MidiEvent } from "@alesis/protocol";

/** A free recording is an append-only journal of fixed-size records, so a power cut loses at most the last flush. */
export const RECORD_BYTES = 16;
export const Kind = { NoteOn: 1, NoteOff: 2, Control: 3, Bend: 4, Pressure: 5, Voice: 6, Kit: 7 } as const;
export const MIDI_PPQ = 960;

export interface JournalRecord {
  /** Milliseconds since the recording began. */
  ms: number;
  kind: number;
  channel: number;
  /** Note, controller or program number. */
  a: number;
  /** Velocity or value. */
  b: number;
  /** Pitch bend 0..16383 (8192 = centre) or bank number. */
  c: number;
}

export interface FreeRecordingMeta {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  state: "recording" | "complete";
  recovered: boolean;
  durationMs: number;
  noteCount: number;
  eventCount: number;
  bpm: number;
  beatsPerMeasure: number;
  synth: { id: string; soundFont: { id: string; name: string; path: string } | null; params: Record<string, number> };
  percussionSoundFontPath: string | null;
  mp3: { state: "none" | "queued" | "rendering" | "ready" | "failed"; bytes: number | null; error?: string };
}

export function encodeRecord(buffer: Buffer, offset: number, record: JournalRecord): void {
  buffer.writeDoubleLE(record.ms, offset);
  buffer[offset + 8] = record.kind;
  buffer[offset + 9] = record.channel;
  buffer[offset + 10] = record.a;
  buffer[offset + 11] = record.b;
  buffer.writeUInt16LE(record.c, offset + 12);
  buffer.writeUInt16LE(0, offset + 14);
}

export function decodeRecord(buffer: Buffer, offset: number): JournalRecord {
  return {
    ms: buffer.readDoubleLE(offset), kind: buffer[offset + 8]!, channel: buffer[offset + 9]!,
    a: buffer[offset + 10]!, b: buffer[offset + 11]!, c: buffer.readUInt16LE(offset + 12),
  };
}

export function recordFromEvent(event: MidiEvent, ms: number): JournalRecord {
  switch (event.type) {
    case "note-on":
      return event.velocity === 0
        ? { ms, kind: Kind.NoteOff, channel: event.channel, a: event.note, b: 0, c: 0 }
        : { ms, kind: Kind.NoteOn, channel: event.channel, a: event.note, b: event.velocity, c: 0 };
    case "note-off": return { ms, kind: Kind.NoteOff, channel: event.channel, a: event.note, b: 0, c: 0 };
    case "control-change": return { ms, kind: Kind.Control, channel: event.channel, a: event.controller, b: event.value, c: 0 };
    case "pitch-bend": return { ms, kind: Kind.Bend, channel: event.channel, a: 0, b: 0, c: bendToWire(event.value) + 8192 };
    case "channel-pressure": return { ms, kind: Kind.Pressure, channel: event.channel, a: 0, b: event.value, c: 0 };
  }
}

export function eventFromRecord(record: JournalRecord): MidiEvent | null {
  switch (record.kind) {
    case Kind.NoteOn: return { type: "note-on", channel: record.channel, note: record.a, velocity: record.b };
    case Kind.NoteOff: return { type: "note-off", channel: record.channel, note: record.a };
    case Kind.Control: return { type: "control-change", channel: record.channel, controller: record.a, value: record.b };
    case Kind.Bend: return { type: "pitch-bend", channel: record.channel, value: Math.max(-1, Math.min(1, (record.c - 8192) / 8192)) };
    case Kind.Pressure: return { type: "channel-pressure", channel: record.channel, value: record.b };
    default: return null;
  }
}

const bendToWire = (value: number): number => Math.max(-8192, Math.min(8191, Math.round(value * 8192)));

export async function* readJournal(path: string): AsyncGenerator<JournalRecord> {
  let carry: Buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    const whole = data.length - data.length % RECORD_BYTES;
    for (let offset = 0; offset < whole; offset += RECORD_BYTES) yield decodeRecord(data, offset);
    carry = data.subarray(whole);
  }
}

export interface JournalScan {
  eventCount: number;
  noteCount: number;
  durationMs: number;
  melodicChannels: Set<number>;
  hasPercussion: boolean;
}

export async function scanJournal(path: string): Promise<JournalScan> {
  const scan: JournalScan = { eventCount: 0, noteCount: 0, durationMs: 0, melodicChannels: new Set(), hasPercussion: false };
  for await (const record of readJournal(path)) {
    scan.eventCount += 1;
    scan.durationMs = Math.max(scan.durationMs, record.ms);
    if (record.kind === Kind.Voice || record.kind === Kind.Kit) continue;
    if (record.kind === Kind.NoteOn) scan.noteCount += 1;
    if (record.channel === 9) scan.hasPercussion = true;
    else scan.melodicChannels.add(record.channel);
  }
  return scan;
}

export type MidiChannels = "all" | "melodic" | "percussion";

class ByteSink {
  private bytes: number[] = [];
  written = 0;
  constructor(private readonly flush: (chunk: Buffer) => Promise<void>) {}
  push(...values: number[]): void { for (const value of values) this.bytes.push(value); }
  vlq(value: number): void {
    let remaining = Math.max(0, Math.floor(value));
    const groups = [remaining & 0x7f];
    while ((remaining = Math.floor(remaining / 128)) > 0) groups.unshift((remaining & 0x7f) | 0x80);
    this.push(...groups);
  }
  async drain(force = false): Promise<void> {
    if (this.bytes.length === 0 || (!force && this.bytes.length < 32_768)) return;
    const chunk = Buffer.from(this.bytes);
    this.bytes = [];
    this.written += chunk.length;
    await this.flush(chunk);
  }
}

/** Writes a format-0 file at the app's tempo, so the notes line up with bars in a DAW. Neither pass keeps events in memory. */
export async function journalToMidi(
  journalPath: string, midiPath: string,
  meta: Pick<FreeRecordingMeta, "bpm" | "beatsPerMeasure" | "synth" | "durationMs">,
  channels: MidiChannels = "all",
  tailMs = 0,
): Promise<void> {
  const scan = await scanJournal(journalPath);
  const handle = await open(midiPath, "w");
  try {
    const header = Buffer.alloc(22);
    header.write("MThd", 0);
    header.writeUInt32BE(6, 4);
    header.writeUInt16BE(0, 8);
    header.writeUInt16BE(1, 10);
    header.writeUInt16BE(MIDI_PPQ, 12);
    header.write("MTrk", 14);
    let position = header.length;
    await handle.write(header, 0, header.length, 0);
    const sink = new ByteSink(async (chunk) => {
      await handle.write(chunk, 0, chunk.length, position);
      position += chunk.length;
    });
    const tickAt = (ms: number): number => Math.round(ms * MIDI_PPQ * meta.bpm / 60_000);
    const melodic = channels !== "percussion" ? [...scan.melodicChannels].sort((a, b) => a - b) : [];
    const name = Buffer.from("Alesis free recording");
    sink.push(0, 0xff, 0x03, name.length, ...name);
    const tempo = Math.round(60_000_000 / meta.bpm);
    sink.push(0, 0xff, 0x51, 3, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff);
    sink.push(0, 0xff, 0x58, 4, meta.beatsPerMeasure, 2, 24, 8);
    const sends = [[91, meta.synth.params["reverb-send"] ?? 0], [93, meta.synth.params["chorus-send"] ?? 0]] as const;
    for (const channel of melodic) for (const [controller, amount] of sends) {
      sink.push(0, 0xb0 | channel, controller, Math.round(Math.max(0, Math.min(1, amount)) * 127));
    }
    let previous = 0;
    const emit = (tick: number, ...message: number[]): void => {
      sink.vlq(tick - previous);
      sink.push(...message);
      previous = tick;
    };
    for await (const record of readJournal(journalPath)) {
      const tick = Math.max(previous, tickAt(record.ms));
      if (record.kind === Kind.Voice) {
        for (const channel of melodic) {
          emit(tick, 0xb0 | channel, 0, (record.c >> 7) & 0x7f);
          emit(tick, 0xb0 | channel, 32, record.c & 0x7f);
          emit(tick, 0xc0 | channel, record.a);
        }
      } else if (record.kind === Kind.Kit) {
        if (channels !== "melodic" && scan.hasPercussion) emit(tick, 0xc9, record.a);
      } else if (channels === "all" || (channels === "percussion") === (record.channel === 9)) {
        const status = record.channel;
        if (record.kind === Kind.NoteOn) emit(tick, 0x90 | status, record.a, record.b);
        else if (record.kind === Kind.NoteOff) emit(tick, 0x80 | status, record.a, 0);
        else if (record.kind === Kind.Control) emit(tick, 0xb0 | status, record.a, record.b);
        else if (record.kind === Kind.Bend) emit(tick, 0xe0 | status, record.c & 0x7f, (record.c >> 7) & 0x7f);
        else if (record.kind === Kind.Pressure) emit(tick, 0xd0 | status, record.b);
      }
      await sink.drain();
    }
    emit(Math.max(previous, tickAt(meta.durationMs + tailMs)), 0xff, 0x2f, 0);
    await sink.drain(true);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(sink.written, 0);
    await handle.write(length, 0, 4, 18);
  } finally {
    await handle.close();
  }
}
