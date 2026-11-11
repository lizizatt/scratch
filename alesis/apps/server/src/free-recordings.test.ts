import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseMidi } from "midi-file";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Kind, RECORD_BYTES, encodeRecord, journalToMidi, readJournal, scanJournal, type FreeRecordingMeta, type JournalRecord } from "./free-recording-format.js";
import { renderFreeRecording } from "./free-recording-render.js";
import { ActivityEnvelope, FreeRecordings, journalEvents, type FreeRecordingContext, type FreeRecordingsOptions } from "./free-recordings.js";

const run = promisify(execFile);
const font = process.env.ALESIS_TEST_SOUNDFONT ?? join(homedir(), "Downloads/STH.sf2");
const haveRenderTools = existsSync(font) && (await run("ffmpeg", ["-version"]).then(() => true, () => false)) && (await run("fluidsynth", ["--version"]).then(() => true, () => false));

let directory: string;
const created: FreeRecordings[] = [];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "alesis-free-test-")); });
afterEach(async () => {
  for (const recordings of created.splice(0)) await recordings.close();
  await rm(directory, { recursive: true, force: true });
});

const context = (overrides: Partial<FreeRecordingContext> = {}): FreeRecordingContext => ({
  bpm: 120, beatsPerMeasure: 4,
  synth: { id: "soundfont", soundFont: { id: "font", name: "Font", path: font }, params: { gain: 0.7, "reverb-send": 0.5 } },
  voice: { bank: 0, program: 4 }, kit: { program: 8 }, soundFontPath: font, percussionSoundFontPath: font,
  ...overrides,
});

function harness(options: Partial<FreeRecordingsOptions> = {}) {
  const clock = { ms: 1_000_000 };
  const renders: string[] = [];
  const recordings = new FreeRecordings({
    directory, now: () => clock.ms, wallClock: () => new Date(2026, 10, 11, 14, 22, 5),
    freeBytes: async () => 10 * 1024 ** 3, statusIntervalMs: 60_000, flushIntervalMs: 60_000, diskCheckIntervalMs: 60_000,
    render: async ({ meta, mp3Path }) => { renders.push(meta.id); await writeFile(mp3Path, "mp3"); return 3; },
    log: () => {}, ...options,
  });
  const at = (ms: number) => { clock.ms = 1_000_000 + ms; };
  created.push(recordings);
  return { recordings, clock, at, renders };
}
const on = (note: number, velocity = 100, channel = 0) => ({ type: "note-on", channel, note, velocity }) as const;
const off = (note: number, channel = 0) => ({ type: "note-off", channel, note }) as const;
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("activity envelope", () => {
  it("fills buckets with the sounding intensity", () => {
    const envelope = new ActivityEnvelope();
    envelope.noteOn("0:60", 127, 0);
    envelope.noteOff("0:60", 600);
    expect(envelope.waveform().slice(0, 3)).toEqual([1, 1, 1]);
    envelope.advance(1_000);
    expect(envelope.waveform().at(-1)).toBe(0);
  });

  it("merges buckets and doubles the axis instead of ever overflowing", () => {
    const envelope = new ActivityEnvelope();
    envelope.noteOn("0:60", 127, 100);
    envelope.noteOff("0:60", 300);
    envelope.advance(250 * 240 + 1);
    expect(envelope.bucketMs).toBe(500);
    expect(envelope.buckets).toHaveLength(240);
    expect(envelope.buckets[0]).toBe(1);
    envelope.advance(500 * 240 * 8);
    expect(envelope.bucketMs).toBe(500 * 16);
    expect(envelope.buckets[0]).toBe(1);
    expect(envelope.waveform().length).toBeLessThanOrEqual(240);
  });
});

describe("journal and MIDI file", () => {
  async function writeJournal(records: JournalRecord[]): Promise<string> {
    const path = join(directory, "x.journal");
    const buffer = Buffer.alloc(records.length * RECORD_BYTES);
    records.forEach((record, index) => encodeRecord(buffer, index * RECORD_BYTES, record));
    await writeFile(path, Buffer.concat([buffer, Buffer.from([1, 2, 3])]));
    return path;
  }
  const meta = { bpm: 120, beatsPerMeasure: 3, durationMs: 4_000, synth: { id: "soundfont", soundFont: null, params: { "reverb-send": 1 } } } as const;
  const records: JournalRecord[] = [
    { ms: 0, kind: Kind.Voice, channel: 0, a: 4, b: 0, c: 129 },
    { ms: 0, kind: Kind.Kit, channel: 9, a: 8, b: 0, c: 0 },
    { ms: 500, kind: Kind.NoteOn, channel: 1, a: 60, b: 90, c: 0 },
    { ms: 750, kind: Kind.Bend, channel: 1, a: 0, b: 0, c: 8192 + 4096 },
    { ms: 1_000, kind: Kind.NoteOff, channel: 1, a: 60, b: 0, c: 0 },
    { ms: 2_000, kind: Kind.NoteOn, channel: 9, a: 38, b: 80, c: 0 },
    { ms: 2_100, kind: Kind.NoteOff, channel: 9, a: 38, b: 0, c: 0 },
  ];

  it("ignores a torn final record and counts what was played", async () => {
    const path = await writeJournal(records);
    expect((await scanJournal(path))).toMatchObject({ eventCount: 7, noteCount: 2, durationMs: 2_100, hasPercussion: true });
    expect(await journalEvents(path)).toHaveLength(7);
  });

  it("writes a standard MIDI file at the app tempo with the voice and effect sends", async () => {
    const path = await writeJournal(records);
    const midi = join(directory, "x.mid");
    await journalToMidi(path, midi, meta);
    const parsed = parseMidi(await readFile(midi));
    expect(parsed.header).toMatchObject({ format: 0, ticksPerBeat: 960 });
    const events = parsed.tracks[0]!;
    expect(events.find((event) => event.type === "setTempo")).toMatchObject({ microsecondsPerBeat: 500_000 });
    expect(events.find((event) => event.type === "timeSignature")).toMatchObject({ numerator: 3 });
    let tick = 0;
    const timed = events.map((event) => ({ ...event, tick: tick += event.deltaTime }));
    // 120 bpm and 960 ticks per beat: 1920 ticks per second.
    expect(timed.find((event) => event.type === "noteOn" && event.channel === 1)).toMatchObject({ tick: 960, noteNumber: 60, velocity: 90 });
    expect(timed.find((event) => event.type === "noteOff" && event.channel === 1)).toMatchObject({ tick: 1_920 });
    expect(timed.find((event) => event.type === "pitchBend")).toMatchObject({ channel: 1, value: 4096 });
    expect(timed.find((event) => event.type === "programChange" && event.channel === 1)).toMatchObject({ programNumber: 4 });
    expect(timed.filter((event) => event.type === "controller" && event.channel === 1 && event.controllerType === 0)).toMatchObject([{ value: 1 }]);
    expect(timed.filter((event) => event.type === "controller" && event.channel === 1 && event.controllerType === 32)).toMatchObject([{ value: 1 }]);
    expect(timed.find((event) => event.type === "controller" && event.channel === 1 && event.controllerType === 91)).toMatchObject({ value: 127 });
    expect(timed.find((event) => event.type === "programChange" && event.channel === 9)).toMatchObject({ programNumber: 8 });
    expect(timed.at(-1)).toMatchObject({ type: "endOfTrack", tick: 4 * 1920 });
  });

  it("can split melodic and percussion parts for separate SoundFonts", async () => {
    const path = await writeJournal(records);
    await journalToMidi(path, join(directory, "m.mid"), meta, "melodic", 1_500);
    await journalToMidi(path, join(directory, "p.mid"), meta, "percussion");
    const melodic = parseMidi(await readFile(join(directory, "m.mid"))).tracks[0]!;
    const percussion = parseMidi(await readFile(join(directory, "p.mid"))).tracks[0]!;
    expect(melodic.some((event) => "channel" in event && event.channel === 9)).toBe(false);
    expect(melodic.reduce((tick, event) => tick + event.deltaTime, 0)).toBe(Math.round(5_500 * 1.92));
    expect(percussion.filter((event) => event.type === "noteOn")).toHaveLength(1);
    expect(percussion.some((event) => "channel" in event && event.channel === 1)).toBe(false);
  });

  it("streams a very large journal without holding it in memory", async () => {
    const path = join(directory, "big.journal");
    const buffer = Buffer.alloc(RECORD_BYTES * 200_000);
    for (let index = 0; index < 100_000; index += 1) {
      encodeRecord(buffer, index * 2 * RECORD_BYTES, { ms: index * 10, kind: Kind.NoteOn, channel: 0, a: 60 + index % 12, b: 90, c: 0 });
      encodeRecord(buffer, (index * 2 + 1) * RECORD_BYTES, { ms: index * 10 + 5, kind: Kind.NoteOff, channel: 0, a: 60 + index % 12, b: 0, c: 0 });
    }
    await writeFile(path, buffer);
    let count = 0;
    for await (const record of readJournal(path)) { count += 1; if (record.kind === Kind.NoteOff) expect(record.ms % 10).toBe(5); }
    expect(count).toBe(200_000);
    await journalToMidi(path, join(directory, "big.mid"), { ...meta, durationMs: 1_000_000 });
    const parsed = parseMidi(await readFile(join(directory, "big.mid")));
    expect(parsed.tracks[0]!.filter((event) => event.type === "noteOn")).toHaveLength(100_000);
  }, 60_000);
});

describe("free recordings", () => {
  it("journals what is played, closes held notes at Stop and writes the MIDI file", async () => {
    const { recordings, at } = harness();
    await recordings.init();
    await recordings.start(context());
    expect(recordings.status().active).toMatchObject({ id: "jam-20261111-142205", elapsedMs: 0 });
    at(100);
    recordings.record(off(70));
    recordings.record(on(60));
    at(600);
    recordings.record({ type: "control-change", channel: 0, controller: 64, value: 127 });
    recordings.record(on(64, 80));
    at(900);
    recordings.record(off(60));
    expect(recordings.status().active).toMatchObject({ noteCount: 2, elapsedMs: 900 });
    at(2_000);
    await recordings.stop();
    await settled();

    const [item] = recordings.status().items;
    expect(item).toMatchObject({ id: "jam-20261111-142205", name: "Jam 2026-11-11 14:22:05", durationMs: 2_000, noteCount: 2, recovered: false });
    expect(item!.midiBytes).toBeGreaterThan(50);
    const records = await journalEvents(join(directory, "jam-20261111-142205.journal"));
    expect(records.filter((record) => record.kind === Kind.NoteOff && record.a === 70)).toHaveLength(0);
    expect(records.filter((record) => record.kind === Kind.NoteOff).map((record) => record.a)).toEqual([60, 64]);
    expect(records.at(-1)).toMatchObject({ kind: Kind.Control, a: 64, b: 0 });
    const meta = JSON.parse(await readFile(join(directory, "jam-20261111-142205.json"), "utf8")) as FreeRecordingMeta;
    expect(meta).toMatchObject({ state: "complete", durationMs: 2_000 });
  });

  it("renders the MP3 after Stop, one at a time, and exposes the files for download", async () => {
    const { recordings, at, renders } = harness();
    await recordings.init();
    await recordings.start(context());
    recordings.record(on(60));
    at(500);
    recordings.record(off(60));
    await recordings.stop();
    await vi.waitFor(() => expect(recordings.status().items[0]!.mp3).toMatchObject({ state: "ready", bytes: 3 }));
    expect(renders).toEqual(["jam-20261111-142205"]);
    expect(recordings.resolveFile("jam-20261111-142205", "mp3")).toMatchObject({ name: "Jam 2026-11-11 14-22-05.mp3" });
    expect(recordings.resolveFile("jam-20261111-142205", "mid")).not.toBeNull();
    expect(recordings.resolveFile("jam-99999999-000000", "mid")).toBeNull();
  });

  it("keeps the MIDI and reports the reason when the render fails, and can retry", async () => {
    let fail = true;
    const { recordings, at } = harness({ render: async ({ mp3Path }) => { if (fail) throw new Error("fluidsynth exited 1: boom"); await writeFile(mp3Path, "ok"); return 2; } });
    await recordings.init();
    await recordings.start(context());
    recordings.record(on(60));
    at(100);
    await recordings.stop();
    await vi.waitFor(() => expect(recordings.status().items[0]!.mp3.state).toBe("failed"));
    expect(recordings.status().items[0]!.mp3.error).toContain("boom");
    expect(recordings.resolveFile("jam-20261111-142205", "mid")).not.toBeNull();
    expect(recordings.resolveFile("jam-20261111-142205", "mp3")).toBeNull();
    fail = false;
    recordings.render("jam-20261111-142205");
    await vi.waitFor(() => expect(recordings.status().items[0]!.mp3.state).toBe("ready"));
  });

  it("refuses an MP3 render that cannot fit on the disk, leaving the MIDI", async () => {
    let free = 10 * 1024 ** 3;
    const { recordings, at, renders } = harness({ freeBytes: async () => free });
    await recordings.init();
    await recordings.start(context());
    recordings.record(on(60));
    at(3_600_000);
    recordings.record(off(60));
    free = 80 * 1024 ** 2;
    await recordings.stop();
    await vi.waitFor(() => expect(recordings.status().items[0]!.mp3.state).toBe("failed"));
    expect(recordings.status().items[0]!.mp3.error).toMatch(/Not enough free space for the MP3/);
    expect(renders).toEqual([]);
  });

  it("discards a recording in which nothing was played", async () => {
    const { recordings } = harness();
    await recordings.init();
    await recordings.start(context());
    recordings.record({ type: "control-change", channel: 0, controller: 1, value: 5 });
    await recordings.stop();
    expect(recordings.status().items).toEqual([]);
    expect(recordings.status().error).toMatch(/Nothing was played/);
    expect(await readdir(directory)).toEqual([]);
  });

  it("refuses to start without room and stops on its own when the disk runs low", async () => {
    let free = 100 * 1024 ** 2;
    const { recordings, at } = harness({ freeBytes: async () => free, diskCheckIntervalMs: 5 });
    await recordings.init();
    await expect(recordings.start(context())).rejects.toThrow(/Not enough free space to record/);
    free = 10 * 1024 ** 3;
    await recordings.start(context());
    recordings.record(on(60));
    at(1_000);
    recordings.record(off(60));
    free = 50 * 1024 ** 2;
    await vi.waitFor(() => expect(recordings.recording).toBe(false));
    expect(recordings.status().error).toMatch(/Free disk space ran low.*saved/);
    expect(recordings.status().items[0]).toMatchObject({ noteCount: 1 });
  });

  it("stops at the event limit and keeps what it has", async () => {
    const { recordings, at } = harness({ limits: { maxEvents: 10 } });
    await recordings.init();
    await recordings.start(context());
    for (let index = 0; index < 6; index += 1) {
      at(index * 10);
      recordings.record(on(60 + index));
      recordings.record(off(60 + index));
    }
    await vi.waitFor(() => expect(recordings.recording).toBe(false));
    expect(recordings.status().error).toMatch(/event limit/);
    expect(recordings.status().items[0]!.noteCount).toBeGreaterThanOrEqual(4);
  });

  it("records preset changes as program changes and refuses a second recording", async () => {
    const { recordings, at } = harness();
    await recordings.init();
    await recordings.start(context());
    await expect(recordings.start(context())).rejects.toThrow(/already in progress/);
    recordings.record(on(60));
    at(1_000);
    recordings.markVoice(0, 40);
    recordings.markKit(16);
    recordings.record(on(38, 100, 9));
    recordings.record(off(60));
    await recordings.stop();
    const midi = parseMidi(await readFile(join(directory, "jam-20261111-142205.mid"))).tracks[0]!;
    expect(midi.filter((event) => event.type === "programChange").map((event) => (event as { programNumber: number }).programNumber)).toEqual([4, 8, 40, 16]);
  });

  it("recovers a recording a power cut left half-written, as MIDI with the MP3 left to the user", async () => {
    const first = harness();
    await first.recordings.init();
    await first.recordings.start(context());
    first.recordings.record(on(60));
    first.at(750);
    first.recordings.record(off(60));
    // Simulate the cut: the journal reached the disk but Stop never ran.
    (first.recordings as unknown as { flush(active: unknown): void }).flush((first.recordings as unknown as { active: unknown }).active);
    await settled();

    const second = harness();
    await second.recordings.init();
    expect(second.recordings.status().items[0]).toMatchObject({ noteCount: 1, durationMs: 750, recovered: true, mp3: { state: "none" } });
    expect(second.recordings.resolveFile("jam-20261111-142205", "mid")).not.toBeNull();
    expect(second.renders).toEqual([]);
    await first.recordings.close();
  });

  it("deletes every file of a recording, but never the one in progress", async () => {
    const { recordings, at } = harness();
    await recordings.init();
    await recordings.start(context());
    recordings.record(on(60));
    await expect(recordings.delete("jam-20261111-142205")).rejects.toThrow(/Stop the recording/);
    at(100);
    await recordings.stop();
    await vi.waitFor(() => expect(recordings.status().items[0]!.mp3.state).toBe("ready"));
    await recordings.delete("jam-20261111-142205");
    expect(recordings.status().items).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it("gives colliding names a numeric suffix", async () => {
    const { recordings, at } = harness();
    await recordings.init();
    for (const expected of ["jam-20261111-142205", "jam-20261111-142205-2"]) {
      await recordings.start(context());
      recordings.record(on(60));
      at(10);
      await recordings.stop();
      expect(recordings.status().items.map(({ id }) => id)).toContain(expected);
    }
  });
});

describe.skipIf(!haveRenderTools)("rendering a free recording with the real tools", () => {
  async function recordSomething(synth: FreeRecordingContext["synth"], withDrums: boolean) {
    const { recordings, at } = harness({ render: async () => 0 });
    await recordings.init();
    await recordings.start(context({ synth }));
    for (const [index, note] of [60, 64, 67].entries()) {
      at(index * 700);
      recordings.record(on(note));
    }
    at(2_200);
    for (const note of [60, 64, 67]) recordings.record(off(note));
    if (withDrums) {
      at(2_300);
      recordings.record(on(38, 110, 9));
      at(2_500);
      recordings.record(off(38, 9));
    }
    at(3_000);
    await recordings.stop();
    await recordings.close();
    return join(directory, "jam-20261111-142205");
  }
  const durationOf = async (path: string) => Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])).stdout);
  const loudness = async (path: string) => {
    const { stderr } = await run("ffmpeg", ["-nostdin", "-i", path, "-af", "volumedetect", "-f", "null", "-"]);
    return Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)?.[1]);
  };

  it("renders SoundFont notes and drum hits straight to an MP3 of the right length", async () => {
    const base = await recordSomething(context().synth, true);
    const meta = JSON.parse(await readFile(`${base}.json`, "utf8")) as FreeRecordingMeta;
    const progress: number[] = [];
    const bytes = await renderFreeRecording({
      journalPath: `${base}.journal`, mp3Path: `${base}.mp3`, meta, soundFontPath: font, percussionSoundFontPath: font,
      signal: new AbortController().signal, onProgress: (fraction) => progress.push(fraction),
    });
    expect(bytes).toBeGreaterThan(10_000);
    expect(await durationOf(`${base}.mp3`)).toBeGreaterThan(4.5);
    expect(await durationOf(`${base}.mp3`)).toBeLessThan(5.6);
    expect(await loudness(`${base}.mp3`)).toBeGreaterThan(-40);
    expect(progress.at(-1)).toBe(1);
    expect(existsSync(`${base}.mp3.part`)).toBe(false);
    expect((await readdir(tmpdir())).filter((name) => name.startsWith("alesis-free-") && !name.startsWith("alesis-free-test-"))).toEqual([]);
  }, 60_000);

  it("renders the Neon synth too", async () => {
    const base = await recordSomething({ id: "subtractive", soundFont: null, params: {} }, false);
    const meta = JSON.parse(await readFile(`${base}.json`, "utf8")) as FreeRecordingMeta;
    await renderFreeRecording({ journalPath: `${base}.journal`, mp3Path: `${base}.mp3`, meta, signal: new AbortController().signal, onProgress: () => {} });
    expect(await durationOf(`${base}.mp3`)).toBeGreaterThan(4);
    expect(await loudness(`${base}.mp3`)).toBeGreaterThan(-45);
  }, 60_000);

  it("cancels cleanly mid-render and leaves no partial file", async () => {
    const base = await recordSomething(context().synth, false);
    const meta = JSON.parse(await readFile(`${base}.json`, "utf8")) as FreeRecordingMeta;
    const controller = new AbortController();
    const rendering = renderFreeRecording({ journalPath: `${base}.journal`, mp3Path: `${base}.mp3`, meta, soundFontPath: font, signal: controller.signal, onProgress: () => {} });
    controller.abort();
    await expect(rendering).rejects.toThrow(/canceled/i);
    expect(existsSync(`${base}.mp3`)).toBe(false);
    expect(existsSync(`${base}.mp3.part`)).toBe(false);
  }, 60_000);

  it("explains a missing SoundFont and refuses a recording with no notes", async () => {
    const base = await recordSomething(context().synth, false);
    const meta = JSON.parse(await readFile(`${base}.json`, "utf8")) as FreeRecordingMeta;
    await expect(renderFreeRecording({ journalPath: `${base}.journal`, mp3Path: `${base}.mp3`, meta, soundFontPath: "/nowhere.sf2", signal: new AbortController().signal, onProgress: () => {} })).rejects.toThrow(/no longer installed/);
    await writeFile(`${base}.journal`, Buffer.alloc(0));
    await expect(renderFreeRecording({ journalPath: `${base}.journal`, mp3Path: `${base}.mp3`, meta, soundFontPath: font, signal: new AbortController().signal, onProgress: () => {} })).rejects.toThrow(/nothing to render/);
    expect((await stat(directory)).isDirectory()).toBe(true);
  }, 60_000);
});
