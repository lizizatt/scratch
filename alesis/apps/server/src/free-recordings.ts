import { open, mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile, type FileHandle } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import {
  FREE_RECORDING_WAVEFORM_BUCKETS,
  freeRecordingIdSchema,
  idleFreeRecording,
  type FreeRecordingItem,
  type FreeRecordingStatus,
  type MidiEvent,
} from "@alesis/protocol";
import {
  Kind, RECORD_BYTES, encodeRecord, journalToMidi, readJournal, recordFromEvent, scanJournal,
  type FreeRecordingMeta, type JournalRecord,
} from "./free-recording-format.js";
import { renderFreeRecording, type FreeRenderRequest } from "./free-recording-render.js";

export interface FreeRecordingContext {
  bpm: number;
  beatsPerMeasure: number;
  synth: FreeRecordingMeta["synth"];
  /** SoundFont preset in effect, if any. */
  voice: { bank: number; program: number } | null;
  kit: { program: number } | null;
  soundFontPath: string | null;
  percussionSoundFontPath: string | null;
}

export interface FreeRecordingLimits {
  /** The journal is 16 bytes per event, so this bounds it at 128 MB. */
  maxEvents: number;
  minFreeBytesToStart: number;
  minFreeBytesWhileRecording: number;
  /** Rough MP3 size (192 kbit/s VBR plus margin) used to refuse a render that cannot fit. */
  mp3BytesPerSecond: number;
}

export const defaultFreeRecordingLimits: FreeRecordingLimits = {
  maxEvents: 8_000_000,
  minFreeBytesToStart: 300 * 1024 * 1024,
  minFreeBytesWhileRecording: 100 * 1024 * 1024,
  mp3BytesPerSecond: 32_000,
};

export interface FreeRecordingsOptions {
  directory: string;
  limits?: Partial<FreeRecordingLimits>;
  /** Monotonic milliseconds; the wall clock may jump on a Pi without a battery clock. */
  now?: () => number;
  wallClock?: () => Date;
  freeBytes?: (directory: string) => Promise<number | null>;
  render?: (request: FreeRenderRequest) => Promise<number>;
  statusIntervalMs?: number;
  diskCheckIntervalMs?: number;
  flushIntervalMs?: number;
  log?: (message: string) => void;
}

const BUFFER_RECORDS = 4_096;

/** Intensity per time bucket; when the axis fills, neighbouring buckets merge and the axis doubles, so no length overflows the display. */
export class ActivityEnvelope {
  readonly buckets = new Array<number>(FREE_RECORDING_WAVEFORM_BUCKETS).fill(0);
  bucketMs = 250;
  private lastMs = 0;
  private lastIndex = 0;
  private held = new Map<string, number>();
  private level = 0;

  advance(ms: number): void {
    while (ms >= this.buckets.length * this.bucketMs) this.merge();
    const first = Math.floor(this.lastMs / this.bucketMs);
    const last = Math.floor(ms / this.bucketMs);
    if (this.level > 0) for (let index = first; index <= last; index += 1) this.buckets[index] = Math.max(this.buckets[index]!, this.level);
    this.lastMs = ms;
    this.lastIndex = Math.max(this.lastIndex, last);
  }
  noteOn(key: string, velocity: number, ms: number): void {
    this.advance(ms);
    this.held.set(key, velocity);
    this.update();
    this.advance(ms);
  }
  noteOff(key: string, ms: number): void {
    this.advance(ms);
    this.held.delete(key);
    this.update();
  }
  waveform(): number[] {
    return this.buckets.slice(0, this.lastIndex + 1).map((value) => Math.round(value * 100) / 100);
  }
  private update(): void {
    let sum = 0;
    for (const velocity of this.held.values()) sum += (velocity / 127) ** 2;
    this.level = Math.min(1, Math.sqrt(sum));
  }
  private merge(): void {
    const half = this.buckets.length / 2;
    for (let index = 0; index < half; index += 1) this.buckets[index] = Math.max(this.buckets[2 * index]!, this.buckets[2 * index + 1]!);
    this.buckets.fill(0, half);
    this.bucketMs *= 2;
    this.lastIndex = Math.floor(this.lastMs / this.bucketMs);
  }
}

interface Active {
  meta: FreeRecordingMeta;
  handle: FileHandle;
  startedAt: number;
  buffer: Buffer;
  count: number;
  envelope: ActivityEnvelope;
  held: Map<string, { channel: number; note: number }>;
  pedals: Set<number>;
  writing: Promise<void>;
  flushes: number;
  eventCount: number;
  noteCount: number;
  lastMs: number;
  /** Time shown as elapsed; keeps running through silence, unlike lastMs which follows the last event. */
  elapsedMs: number;
  timers: Array<ReturnType<typeof setInterval>>;
  failure: string | null;
  closing: boolean;
  warning: string | null;
}

interface Entry { meta: FreeRecordingMeta; midiBytes: number; progress?: number }

export class FreeRecordings {
  private readonly limits: FreeRecordingLimits;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(status: FreeRecordingStatus) => void>();
  private active: Active | null = null;
  private stopping: Promise<void> | null = null;
  private notice: string | null = null;
  private diskFree: number | null = null;
  private queue: string[] = [];
  private rendering: { id: string; controller: AbortController; done: Promise<void> } | null = null;
  private closed = false;

  constructor(private readonly options: FreeRecordingsOptions) {
    this.limits = { ...defaultFreeRecordingLimits, ...options.limits };
    this.now = options.now ?? (() => performance.now());
  }

  get recording(): boolean { return this.active !== null; }

  /** Loads finished recordings and recovers any a power cut left half-written. */
  async init(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true });
    for (const name of await readdir(this.options.directory)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      if (!freeRecordingIdSchema.safeParse(id).success) continue;
      try {
        const meta = JSON.parse(await readFile(this.path(id, "json"), "utf8")) as FreeRecordingMeta;
        if (meta.version !== 1 || meta.id !== id) continue;
        if (meta.state === "recording") await this.recover(meta);
        else if (meta.mp3.state === "queued" || meta.mp3.state === "rendering") {
          meta.mp3 = { state: "none", bytes: null };
          await this.saveMeta(meta);
        }
        this.entries.set(id, { meta, midiBytes: await this.size(id, "mid") });
      } catch (error) {
        this.log(`Unable to load free recording ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.diskFree = await this.freeBytes();
    this.emit();
  }

  status(): FreeRecordingStatus {
    const active = this.active;
    const items = [...this.entries.values()]
      .sort((left, right) => right.meta.createdAt.localeCompare(left.meta.createdAt) || right.meta.id.localeCompare(left.meta.id))
      .slice(0, 200)
      .map((entry): FreeRecordingItem => ({
        id: entry.meta.id, name: entry.meta.name, createdAt: entry.meta.createdAt, durationMs: entry.meta.durationMs,
        noteCount: entry.meta.noteCount, recovered: entry.meta.recovered, midiBytes: entry.midiBytes,
        mp3: {
          state: entry.meta.mp3.state, bytes: entry.meta.mp3.bytes,
          ...entry.meta.mp3.state === "rendering" && entry.progress !== undefined ? { progress: entry.progress } : {},
          ...entry.meta.mp3.error ? { error: entry.meta.mp3.error } : {},
        },
      }));
    if (!active && items.length === 0 && this.notice === null && this.diskFree === null) return { ...idleFreeRecording };
    return {
      active: active ? {
        id: active.meta.id, elapsedMs: Math.round(Math.max(active.elapsedMs, active.lastMs)), noteCount: active.noteCount, eventCount: active.eventCount,
        waveform: active.envelope.waveform(), bucketMs: active.envelope.bucketMs, buckets: FREE_RECORDING_WAVEFORM_BUCKETS,
        warning: active.warning,
      } : null,
      items, diskFreeBytes: this.diskFree, error: this.notice,
    };
  }

  subscribe(listener: (status: FreeRecordingStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(context: FreeRecordingContext): Promise<void> {
    if (this.closed) throw new Error("Recording is unavailable while the host shuts down");
    if (this.active || this.stopping) throw new Error("A recording is already in progress");
    await mkdir(this.options.directory, { recursive: true });
    const free = await this.freeBytes();
    this.diskFree = free;
    if (free !== null && free < this.limits.minFreeBytesToStart) {
      throw new Error(`Not enough free space to record: ${megabytes(free)} MB free, ${megabytes(this.limits.minFreeBytesToStart)} MB needed`);
    }
    const { id, name, createdAt } = await this.newIdentity();
    const meta: FreeRecordingMeta = {
      version: 1, id, name, createdAt, state: "recording", recovered: false, durationMs: 0, noteCount: 0, eventCount: 0,
      bpm: context.bpm, beatsPerMeasure: context.beatsPerMeasure, synth: context.synth,
      percussionSoundFontPath: context.percussionSoundFontPath, mp3: { state: "none", bytes: null },
    };
    await this.saveMeta(meta);
    const handle = await open(this.path(id, "journal"), "a");
    const active: Active = {
      meta, handle, startedAt: this.now(), buffer: Buffer.alloc(BUFFER_RECORDS * RECORD_BYTES), count: 0,
      envelope: new ActivityEnvelope(), held: new Map(), pedals: new Set(), writing: Promise.resolve(), flushes: 0,
      eventCount: 0, noteCount: 0, lastMs: 0, elapsedMs: 0, timers: [], failure: null, closing: false, warning: null,
    };
    this.active = active;
    this.notice = null;
    if (context.voice) this.append(active, { ms: 0, kind: Kind.Voice, channel: 0, a: context.voice.program, b: 0, c: context.voice.bank });
    if (context.kit) this.append(active, { ms: 0, kind: Kind.Kit, channel: 9, a: context.kit.program, b: 0, c: 0 });
    active.timers.push(
      setInterval(() => this.flush(active), this.options.flushIntervalMs ?? 500),
      setInterval(() => {
        active.elapsedMs = Math.max(active.elapsedMs, this.now() - active.startedAt);
        active.envelope.advance(active.elapsedMs);
        this.emit();
      }, this.options.statusIntervalMs ?? 250),
      setInterval(() => void this.checkDisk(active), this.options.diskCheckIntervalMs ?? 10_000),
    );
    for (const timer of active.timers) timer.unref();
    this.emit();
  }

  /** Called for every event the synth sounds. */
  record(event: MidiEvent): void {
    const active = this.active;
    if (!active || active.failure || active.closing) return;
    const ms = Math.max(active.lastMs, this.now() - active.startedAt);
    const record = recordFromEvent(event, ms);
    active.elapsedMs = Math.max(active.elapsedMs, ms);
    const key = `${record.channel}:${record.a}`;
    if (record.kind === Kind.NoteOff && !active.held.has(key)) return;
    if (record.kind === Kind.NoteOn) {
      active.held.set(key, { channel: record.channel, note: record.a });
      active.noteCount += 1;
      active.envelope.noteOn(key, record.b, ms);
    } else if (record.kind === Kind.NoteOff) {
      active.held.delete(key);
      active.envelope.noteOff(key, ms);
    } else {
      active.envelope.advance(ms);
      if (record.kind === Kind.Control && record.a === 64) {
        if (record.b >= 64) active.pedals.add(record.channel);
        else active.pedals.delete(record.channel);
      }
    }
    this.append(active, record);
    if (active.eventCount >= this.limits.maxEvents) this.autoStop("The event limit was reached");
    else if (active.eventCount >= this.limits.maxEvents * 0.8) active.warning = "Approaching the event limit for one recording";
  }

  /** A panic has silenced the synth, so close every note and pedal the recording still holds open. */
  silence(): void {
    const active = this.active;
    if (!active || active.closing) return;
    const ms = Math.max(active.lastMs, this.now() - active.startedAt);
    active.envelope.advance(ms);
    for (const { channel, note } of active.held.values()) {
      this.append(active, { ms, kind: Kind.NoteOff, channel, a: note, b: 0, c: 0 });
      active.envelope.noteOff(`${channel}:${note}`, ms);
    }
    active.held.clear();
    for (const channel of active.pedals) this.append(active, { ms, kind: Kind.Control, channel, a: 64, b: 0, c: 0 });
    active.pedals.clear();
  }

  /** A preset change mid-recording; the new voice applies to everything after it. */
  markVoice(bank: number, program: number): void {
    const active = this.active;
    if (active && !active.closing) this.append(active, { ms: Math.max(active.lastMs, this.now() - active.startedAt), kind: Kind.Voice, channel: 0, a: program, b: 0, c: bank });
  }
  markKit(program: number): void {
    const active = this.active;
    if (active && !active.closing) this.append(active, { ms: Math.max(active.lastMs, this.now() - active.startedAt), kind: Kind.Kit, channel: 9, a: program, b: 0, c: 0 });
  }

  async stop(notice: string | null = null): Promise<void> {
    if (this.stopping) return this.stopping;
    const active = this.active;
    if (!active) return;
    this.stopping = this.finalize(active, notice).finally(() => { this.stopping = null; });
    return this.stopping;
  }

  render(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || this.active?.meta.id === id) throw new Error("Recording is not available to render");
    if (["queued", "rendering"].includes(entry.meta.mp3.state)) return;
    this.enqueue(entry);
  }

  async delete(id: string): Promise<void> {
    if (this.active?.meta.id === id) throw new Error("Stop the recording before deleting it");
    const entry = this.entries.get(id);
    if (!entry) throw new Error("Unknown recording");
    this.queue = this.queue.filter((queued) => queued !== id);
    if (this.rendering?.id === id) {
      this.rendering.controller.abort();
      await this.rendering.done;
    }
    this.entries.delete(id);
    for (const extension of ["json", "journal", "mid", "mp3", "mp3.part"]) await rm(this.path(id, extension), { force: true });
    this.emit();
  }

  resolveFile(id: string, extension: "mid" | "mp3"): { path: string; name: string } | null {
    const entry = this.entries.get(id);
    if (!entry || extension === "mp3" && entry.meta.mp3.state !== "ready") return null;
    if (extension === "mid" && entry.midiBytes === 0) return null;
    return { path: this.path(id, extension), name: `${entry.meta.name.replace(/[^A-Za-z0-9 _.-]/g, "-")}.${extension}` };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.stop("Recording stopped because the host is shutting down. Everything played was saved.");
    this.queue = [];
    if (this.rendering) { this.rendering.controller.abort(); await this.rendering.done; }
    this.listeners.clear();
  }

  private path(id: string, extension: string): string { return join(this.options.directory, `${id}.${extension}`); }
  private log(message: string): void { (this.options.log ?? console.error)(message); }
  private async size(id: string, extension: string): Promise<number> {
    try { return (await stat(this.path(id, extension))).size; } catch { return 0; }
  }
  private async freeBytes(): Promise<number | null> {
    try {
      if (this.options.freeBytes) return await this.options.freeBytes(this.options.directory);
      const info = await statfs(this.options.directory);
      return Number(info.bavail) * Number(info.bsize);
    } catch { return null; }
  }
  private emit(): void {
    if (this.closed && this.listeners.size === 0) return;
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }
  private saving: Promise<unknown> = Promise.resolve();
  /** Saves are serialized because they share one temporary file name. */
  private saveMeta(meta: FreeRecordingMeta): Promise<void> {
    const target = this.path(meta.id, "json");
    const run = this.saving.then(async () => {
      await writeFile(`${target}.tmp`, JSON.stringify(meta, null, 1));
      await rename(`${target}.tmp`, target);
    });
    this.saving = run.catch(() => {});
    return run;
  }

  private async newIdentity(): Promise<{ id: string; name: string; createdAt: string }> {
    const date = (this.options.wallClock ?? (() => new Date()))();
    const two = (value: number): string => String(value).padStart(2, "0");
    const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`;
    const clock = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
    let id = `jam-${day}-${clock}`;
    for (let suffix = 2; this.entries.has(id) || await this.size(id, "json") > 0; suffix += 1) id = `jam-${day}-${clock}-${suffix}`;
    const name = `Jam ${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
    return { id, name, createdAt: date.toISOString() };
  }

  private append(active: Active, record: JournalRecord): void {
    encodeRecord(active.buffer, active.count * RECORD_BYTES, record);
    active.count += 1;
    active.eventCount += 1;
    active.lastMs = record.ms;
    if (active.count === BUFFER_RECORDS) this.flush(active);
  }

  private flush(active: Active): void {
    if (active.count === 0) return;
    const chunk = Buffer.from(active.buffer.subarray(0, active.count * RECORD_BYTES));
    active.count = 0;
    const sync = ++active.flushes % 4 === 0;
    active.writing = active.writing.then(async () => {
      await active.handle.write(chunk);
      if (sync) await active.handle.datasync();
    }).catch((error: unknown) => {
      if (active.failure) return;
      active.failure = error instanceof Error ? error.message : String(error);
      this.autoStop(`The journal could not be written (${active.failure})`);
    });
  }

  private async checkDisk(active: Active): Promise<void> {
    const free = await this.freeBytes();
    this.diskFree = free;
    if (this.active !== active || free === null) return;
    if (free < this.limits.minFreeBytesWhileRecording) this.autoStop(`Free disk space ran low (${megabytes(free)} MB left)`);
    else if (free < this.limits.minFreeBytesToStart) active.warning = `Low disk space: ${megabytes(free)} MB free`;
    else if (!active.warning?.startsWith("Approaching")) active.warning = null;
  }

  private autoStop(reason: string): void {
    void this.stop(`Recording stopped automatically: ${reason}. Everything up to that point was saved.`).catch((error) => this.log(`Auto-stop failed: ${String(error)}`));
  }

  private async finalize(active: Active, notice: string | null): Promise<void> {
    active.closing = true;
    for (const timer of active.timers) clearInterval(timer);
    const endMs = Math.max(active.lastMs, this.now() - active.startedAt);
    for (const { channel, note } of active.held.values()) this.append(active, { ms: endMs, kind: Kind.NoteOff, channel, a: note, b: 0, c: 0 });
    for (const channel of active.pedals) this.append(active, { ms: endMs, kind: Kind.Control, channel, a: 64, b: 0, c: 0 });
    active.envelope.advance(endMs);
    this.flush(active);
    await active.writing;
    await active.handle.datasync().catch(() => {});
    await active.handle.close();
    this.active = null;
    const { meta } = active;
    if (active.noteCount === 0) {
      for (const extension of ["json", "journal"]) await rm(this.path(meta.id, extension), { force: true });
      this.notice = "Nothing was played, so nothing was saved.";
      this.emit();
      return;
    }
    meta.durationMs = endMs;
    meta.noteCount = active.noteCount;
    meta.eventCount = active.eventCount;
    meta.state = "complete";
    this.notice = notice;
    try {
      await journalToMidi(this.path(meta.id, "journal"), this.path(meta.id, "mid"), meta);
    } catch (error) {
      this.notice = `${notice ?? ""} The MIDI file could not be written: ${error instanceof Error ? error.message : String(error)}`.trim();
    }
    await this.saveMeta(meta);
    const entry: Entry = { meta, midiBytes: await this.size(meta.id, "mid") };
    this.entries.set(meta.id, entry);
    this.emit();
    if (!this.closed) this.enqueue(entry);
  }

  private async recover(meta: FreeRecordingMeta): Promise<void> {
    const journal = this.path(meta.id, "journal");
    if (await this.size(meta.id, "journal") === 0) {
      await rm(this.path(meta.id, "json"), { force: true });
      throw new Error("journal is empty, so the recording was discarded");
    }
    const scan = await scanJournal(journal);
    if (scan.noteCount === 0) {
      for (const extension of ["json", "journal"]) await rm(this.path(meta.id, extension), { force: true });
      throw new Error("no notes were recorded, so it was discarded");
    }
    Object.assign(meta, { state: "complete", recovered: true, durationMs: scan.durationMs, noteCount: scan.noteCount, eventCount: scan.eventCount });
    meta.mp3 = { state: "none", bytes: null };
    await journalToMidi(journal, this.path(meta.id, "mid"), meta);
    await this.saveMeta(meta);
    this.log(`Recovered free recording ${meta.id} after an unclean shutdown`);
  }

  private enqueue(entry: Entry): void {
    entry.meta.mp3 = { state: "queued", bytes: null };
    delete entry.progress;
    this.queue.push(entry.meta.id);
    void this.saveMeta(entry.meta).catch(() => {});
    this.emit();
    this.pump();
  }

  private pump(): void {
    if (this.rendering || this.closed) return;
    const id = this.queue.shift();
    if (!id) return;
    const entry = this.entries.get(id);
    if (!entry) { this.pump(); return; }
    const controller = new AbortController();
    const done = this.renderEntry(entry, controller).finally(() => { this.rendering = null; this.pump(); });
    this.rendering = { id, controller, done };
  }

  private async renderEntry(entry: Entry, controller: AbortController): Promise<void> {
    const { meta } = entry;
    meta.mp3 = { state: "rendering", bytes: null };
    entry.progress = 0;
    this.emit();
    try {
      const free = await this.freeBytes();
      const needed = meta.durationMs / 1000 * this.limits.mp3BytesPerSecond + 50 * 1024 * 1024;
      if (free !== null && free < needed) throw new Error(`Not enough free space for the MP3: about ${megabytes(needed)} MB needed, ${megabytes(free)} MB free`);
      const bytes = await (this.options.render ?? renderFreeRecording)({
        journalPath: this.path(meta.id, "journal"), mp3Path: this.path(meta.id, "mp3"), meta,
        soundFontPath: meta.synth.soundFont?.path, percussionSoundFontPath: meta.percussionSoundFontPath ?? undefined,
        signal: controller.signal,
        onProgress: (fraction) => { entry.progress = fraction; },
      });
      meta.mp3 = { state: "ready", bytes };
    } catch (error) {
      await rm(this.path(meta.id, "mp3.part"), { force: true });
      meta.mp3 = { state: controller.signal.aborted ? "none" : "failed", bytes: null, ...controller.signal.aborted ? {} : { error: (error instanceof Error ? error.message : String(error)).slice(0, 500) } };
      if (!controller.signal.aborted) this.log(`Free recording ${meta.id} MP3 render failed: ${meta.mp3.error}`);
    }
    delete entry.progress;
    if (this.entries.has(meta.id)) await this.saveMeta(meta).catch(() => {});
    this.emit();
  }
}

const megabytes = (bytes: number): number => Math.round(bytes / (1024 * 1024));

/** Replays a journal's notes for tests and diagnostics. */
export async function journalEvents(path: string): Promise<JournalRecord[]> {
  const records: JournalRecord[] = [];
  for await (const record of readJournal(path)) records.push(record);
  return records;
}
