import { afterEach, describe, expect, it, vi } from "vitest";
import { SilentAudioOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type EngineResult, type MidiEvent } from "@alesis/engine";
import type { EditableNote, EngineCommand } from "@alesis/protocol";
import { executeLoopCommand } from "./loop-commands.js";
import { MidiLoopScheduler, type RecordedMidiEvent } from "./loop-playback.js";
import { executeTakeNotesCommand } from "./take-editing.js";
import { normalizeNotes, notesFromRecording, recordingFromNotes } from "./take-notes.js";

const on = (position: number, note: number, velocity = 100, channel = 1): RecordedMidiEvent => ({ position, event: { type: "note-on", channel, note, velocity } });
const off = (position: number, note: number, channel = 1): RecordedMidiEvent => ({ position, event: { type: "note-off", channel, note } });
const note = (id: number, noteNumber: number, start: number, duration: number, velocity = 100, channel = 1): EditableNote => ({ id, channel, note: noteNumber, velocity, start, duration });

describe("take notes", () => {
  it("pairs attacks with releases and leaves controllers out", () => {
    const sustain: RecordedMidiEvent = { position: 0.3, event: { type: "control-change", channel: 1, controller: 64, value: 127 } };
    expect(notesFromRecording([on(0.1, 60, 90), off(0.2, 60), sustain, on(0.5, 64), off(0.75, 64)])).toEqual([
      note(0, 60, 0.1, 0.1, 90), note(1, 64, 0.5, 0.25),
    ]);
  });

  it("reads a gate that wraps the loop end as one note", () => {
    const wrapped = [{ ...on(0, 60), continuation: true as const }, off(0.2, 60), on(0.9, 60), off(1, 60)];
    const [only, ...rest] = notesFromRecording(wrapped);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ note: 60, start: 0.9 });
    expect(only!.duration).toBeCloseTo(0.3, 9);
  });

  it("rebuilds the same events, controllers untouched and releases before attacks", () => {
    const sustain: RecordedMidiEvent = { position: 0.3, event: { type: "control-change", channel: 1, controller: 64, value: 127 } };
    const original = [on(0.1, 60, 90), off(0.2, 60), sustain, on(0.2, 62), off(0.9, 62)];
    const rebuilt = recordingFromNotes(notesFromRecording(original), original);
    // Positions are recomputed as start + duration, so allow for floating-point noise.
    const rounded = (events: RecordedMidiEvent[]) => events.map((item) => ({ ...item, position: Number(item.position.toFixed(9)) }));
    expect(rounded(rebuilt)).toEqual(rounded([on(0.1, 60, 90), off(0.2, 60), on(0.2, 62), sustain, off(0.9, 62)]));
  });

  it("splits a wrapped note into a closing release and a continued attack", () => {
    const rebuilt = recordingFromNotes([note(0, 60, 0.9, 0.3)], []);
    expect(rebuilt.map(({ position, event, continuation }) => [position.toFixed(6), event.type, continuation ?? false])).toEqual([
      ["0.000000", "note-on", true], ["0.200000", "note-off", false], ["0.900000", "note-on", false], ["1.000000", "note-off", false],
    ]);
    expect(notesFromRecording(rebuilt)).toHaveLength(1);
  });

  it("cuts a note where the next one on the same key begins, circularly, without touching other keys", () => {
    const result = normalizeNotes([note(0, 60, 0.1, 0.5), note(1, 60, 0.3, 0.5), note(2, 62, 0.1, 0.9)]);
    const byId = new Map(result.map((entry) => [entry.id, entry]));
    expect(byId.get(0)!.duration).toBeCloseTo(0.2, 9);
    expect(byId.get(1)!.duration).toBeCloseTo(0.5, 9);
    expect(byId.get(2)!.duration).toBe(0.9);
    const circular = normalizeNotes([note(0, 60, 0.1, 0.2), note(1, 60, 0.8, 0.9)]);
    expect(circular.find(({ id }) => id === 1)!.duration).toBeCloseTo(0.3, 9);
  });

  it("keeps only the later of two attacks on the same key at the same moment", () => {
    expect(normalizeNotes([note(0, 60, 0.4, 0.1, 50), note(1, 60, 0.4, 0.2, 80)]).map(({ id }) => id)).toEqual([1]);
  });

  it("round-trips arbitrary non-overlapping notes", () => {
    const notes = [note(0, 48, 0, 0.05, 20), note(1, 60, 0.25, 0.5, 127), note(2, 61, 0.25, 0.75, 1), note(3, 72, 0.99, 0.5, 64, 9)];
    const rebuilt = notesFromRecording(recordingFromNotes(normalizeNotes(notes), []));
    expect(rebuilt.map(({ id: _id, ...rest }) => rest)).toEqual(normalizeNotes(notes).map(({ id: _id, ...rest }) => rest));
  });
});

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((dispose) => dispose())); });

async function host() {
  const engine = new SimulatedHostEngine();
  disposers.push(() => engine.dispose());
  const played: MidiEvent[] = [];
  const output: AudioOutput = new SilentAudioOutput();
  output.dispatchMidi = (event) => { played.push(event); };
  const loops = new MidiLoopScheduler(output, { stagedWaveform: (id, waveform) => engine.setStagedWaveform(id, waveform) });
  const playback = { transaction: <T>(action: () => Promise<T>) => action() };
  const command = async (next: EngineCommand): Promise<EngineResult> => {
    const result = next.type === "get-take-notes" || next.type === "set-take-notes"
      ? await executeTakeNotesCommand(next, engine, loops, playback)
      : await executeLoopCommand(next, engine, loops, playback);
    loops.update(engine.snapshot());
    return result;
  };
  await command({ type: "configure", settings: { bpm: 120, loopMeasures: 1, countInEnabled: false } });
  let time = 0;
  const until = (seconds: number) => {
    engine.advance(seconds - time);
    time = seconds;
    loops.update(engine.snapshot());
  };
  const play = (noteNumber: number, from: number, to: number, velocity = 100) => {
    until(from);
    loops.record({ type: "note-on", channel: 1, note: noteNumber, velocity }, engine.snapshot());
    until(to);
    loops.record({ type: "note-off", channel: 1, note: noteNumber }, engine.snapshot());
  };
  const run = (seconds: number) => until(time + seconds);
  /** A staged take holding notes 60 (0.1-0.2) and 64 (0.5-0.75), recorded in the first 2 s pass. */
  const recordStaged = async () => {
    await command({ type: "play" });
    play(60, 0.2, 0.4, 90);
    play(64, 1, 1.5);
    until(2.01);
    return engine.snapshot().capture.staged!;
  };
  const notesOf = async (takeId: string) => (await command({ type: "get-take-notes", takeId })).takeNotes!;
  return { engine, loops, played, command, until, run, play, recordStaged, notesOf };
}

describe("auditioning a note while editing", () => {
  const audition = { takeId: "", note: 62, channel: 1, velocity: 100, durationMs: 300 };

  it("sounds the note at the take's level without recording it, then releases it", async () => {
    vi.useFakeTimers();
    try {
      const h = await host();
      const staged = await h.recordStaged();
      await h.command({ type: "stop" });
      const before = h.loops.exportRecordings([staged.id]).get(staged.id);
      h.played.length = 0;

      expect(h.loops.auditionNote(h.engine.runtimeSnapshot(), { ...audition, takeId: staged.id })).toBe(true);
      expect(h.played).toEqual([expect.objectContaining({ type: "note-on", note: 62, velocity: 80 })]);
      const channel = h.played[0]!.channel;
      expect(channel).not.toBe(1);
      await vi.advanceTimersByTimeAsync(300);
      expect(h.played.at(-1)).toEqual({ type: "note-off", channel, note: 62 });
      expect(h.loops.exportRecordings([staged.id]).get(staged.id)).toEqual(before);
    } finally { vi.useRealTimers(); }
  });

  it("restarts a repeated note, keeps drums on the drum channel, and ignores unknown takes", async () => {
    vi.useFakeTimers();
    try {
      const h = await host();
      const staged = await h.recordStaged();
      await h.command({ type: "stop" });
      h.played.length = 0;
      h.loops.auditionNote(h.engine.runtimeSnapshot(), { ...audition, takeId: staged.id });
      h.loops.auditionNote(h.engine.runtimeSnapshot(), { ...audition, takeId: staged.id });
      expect(h.played.map(({ type }) => type)).toEqual(["note-on", "note-off", "note-on"]);

      h.played.length = 0;
      h.loops.auditionNote(h.engine.runtimeSnapshot(), { ...audition, takeId: staged.id, channel: 9, note: 38 });
      expect(h.played[0]).toMatchObject({ type: "note-on", channel: 9, note: 38 });
      expect(h.loops.auditionNote(h.engine.runtimeSnapshot(), { ...audition, takeId: "missing" })).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("drops the pending release when cancelled, as a host panic has already silenced the renderer", async () => {
    vi.useFakeTimers();
    try {
      const h = await host();
      const staged = await h.recordStaged();
      await h.command({ type: "stop" });
      h.loops.auditionNote(h.engine.runtimeSnapshot(), { ...audition, takeId: staged.id });
      h.played.length = 0;
      h.loops.cancelAuditions();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(h.played).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

describe("editing a take's notes through the host", () => {
  it("reads a staged take's notes and rejects unknown takes", async () => {
    const h = await host();
    const staged = await h.recordStaged();
    const { notes, version } = await h.notesOf(staged.id);
    expect(notes.map(({ note: key, velocity }) => [key, velocity])).toEqual([[60, 90], [64, 100]]);
    expect(notes[0]!.start).toBeCloseTo(0.1, 2);
    expect(version).toBeGreaterThan(0);
    expect(await h.command({ type: "get-take-notes", takeId: "missing" })).toMatchObject({ accepted: false });
  });

  it("moves a note, replays it at the new time and redraws the waveform", async () => {
    const h = await host();
    const staged = await h.recordStaged();
    await h.command({ type: "stop" });
    const { notes, version } = await h.notesOf(staged.id);
    const before = h.engine.snapshot().capture.staged!.waveform;
    const result = await h.command({ type: "set-take-notes", takeId: staged.id, version, notes: notes.map((entry) => entry.note === 64 ? { ...entry, start: 0.6, velocity: 5 } : entry) });
    expect(result.accepted).toBe(true);
    const moved = h.loops.exportRecordings([staged.id]).get(staged.id)!.find(({ event }) => event.type === "note-on" && event.note === 64)!;
    expect(moved).toMatchObject({ position: 0.6, event: { velocity: 5 } });
    expect(h.engine.snapshot().capture.staged!.waveform).not.toEqual(before);

    h.played.length = 0;
    await h.command({ type: "play" });
    h.run(1.3);
    // Replay applies the take level (0.8) to the edited velocity.
    expect(h.played.find((event) => event.type === "note-on" && event.note === 64)).toMatchObject({ velocity: 4 });
  });

  it("accepts velocities outside the configured impact range", async () => {
    const h = await host();
    await h.command({ type: "configure", settings: { minimumVelocity: 60, maximumVelocity: 70 } });
    const staged = await h.recordStaged();
    await h.command({ type: "stop" });
    const { notes, version } = await h.notesOf(staged.id);
    const result = await h.command({ type: "set-take-notes", takeId: staged.id, version, notes: notes.map((entry, index) => ({ ...entry, velocity: index === 0 ? 1 : 127 })) });
    expect(result.accepted).toBe(true);
    expect((await h.notesOf(staged.id)).notes.map(({ velocity }) => velocity)).toEqual([1, 127]);
  });

  it("rejects an edit made against an outdated version", async () => {
    const h = await host();
    const staged = await h.recordStaged();
    await h.command({ type: "stop" });
    const { notes, version } = await h.notesOf(staged.id);
    expect((await h.command({ type: "set-take-notes", takeId: staged.id, version, notes })).accepted).toBe(true);
    const stale = await h.command({ type: "set-take-notes", takeId: staged.id, version, notes });
    expect(stale).toMatchObject({ accepted: false });
    expect(stale.error).toMatch(/changed/);
  });

  it("keeps edited timing when the staged quantization is unchanged and re-derives it when changed", async () => {
    const h = await host();
    await h.command({ type: "set-quantization", mode: "1/4" });
    const staged = await h.recordStaged();
    await h.command({ type: "stop" });
    const { notes, version } = await h.notesOf(staged.id);
    await h.command({ type: "set-take-notes", takeId: staged.id, version, notes: notes.map((entry) => entry.note === 60 ? { ...entry, start: 0.13 } : entry) });
    await h.command({ type: "play" });
    h.run(0.1);
    expect((await h.notesOf(staged.id)).notes.find(({ note: key }) => key === 60)!.start).toBeCloseTo(0.13, 9);
    // Saved sessions carry the edit as the staged take's raw timing too.
    const savedRaw = h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording;
    expect(savedRaw.find(({ event }) => event.type === "note-on" && event.note === 60)!.position).toBeCloseTo(0.13, 9);
    await h.command({ type: "set-quantization", mode: "1/8" });
    h.run(0.1);
    const requantized = (await h.notesOf(staged.id)).notes.find(({ note: key }) => key === 60)!.start;
    expect(requantized).toBeCloseTo(0.125, 9);
  });

  it("edits promoted takes and keeps them in saved sessions", async () => {
    const h = await host();
    const staged = await h.recordStaged();
    await h.command({ type: "promote-staged" });
    await h.command({ type: "stop" });
    const { notes, version } = await h.notesOf(staged.id);
    expect((await h.command({ type: "set-take-notes", takeId: staged.id, version, notes: notes.filter((entry) => entry.note !== 64) })).accepted).toBe(true);
    const saved = h.loops.captureSessionTakes(h.engine.snapshot());
    expect(saved.promoted[0]!.recording.filter(({ event }) => event.type === "note-on")).toHaveLength(1);
  });

  it("edits the take being overdubbed while it plays; only a pass that adds notes makes an open editor stale", async () => {
    const h = await host();
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    h.play(60, 0.2, 0.4);
    h.until(2.01);
    const staged = h.engine.snapshot().capture.staged!;
    const opened = await h.notesOf(staged.id);

    h.until(4.01);
    expect((await h.notesOf(staged.id)).version).toBe(opened.version);
    const edited = await h.command({ type: "set-take-notes", takeId: staged.id, version: opened.version, notes: opened.notes.map((entry) => ({ ...entry, start: 0.6 })) });
    expect(edited.accepted).toBe(true);
    const reread = await h.notesOf(staged.id);
    expect(reread.notes[0]!.start).toBeCloseTo(0.6, 9);

    h.play(64, 4.2, 4.4);
    h.until(6.01);
    const stale = await h.command({ type: "set-take-notes", takeId: staged.id, version: reread.version, notes: reread.notes });
    expect(stale).toMatchObject({ accepted: false });
    expect((await h.notesOf(staged.id)).notes.map(({ note: key }) => key).sort()).toEqual([60, 64]);
  });

  it("releases a note that is sounding from the take when it is edited", async () => {
    const h = await host();
    const staged = await h.recordStaged();
    h.played.length = 0;
    h.until(2.3);
    expect(h.played.some((event) => event.type === "note-on" && event.note === 60)).toBe(true);
    const { notes, version } = await h.notesOf(staged.id);
    await h.command({ type: "set-take-notes", takeId: staged.id, version, notes: notes.filter((entry) => entry.note !== 60) });
    expect(h.played.some((event) => event.type === "note-off" && event.note === 60)).toBe(true);
  });
});
