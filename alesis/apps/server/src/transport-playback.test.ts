import { describe, expect, it, vi } from "vitest";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { SilentAudioOutput } from "@alesis/audio";
import { MidiArpeggiator, type ArpeggiatorConfig } from "./arpeggiator.js";
import type { DrumPlaybackClock } from "./drum-playback.js";
import { TransportPlayback } from "./transport-playback.js";
import { PerformanceRouter } from "./performance-router.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { executeLoopCommand } from "./loop-commands.js";
import type { EngineCommand } from "@alesis/protocol";

type Timer = ReturnType<typeof setTimeout>;
class Clock implements DrumPlaybackClock {
  time = 0;
  id = 0;
  pending = new Map<Timer, { at: number; callback: () => void }>();
  now = () => this.time;
  setTimeout = (callback: () => void, delay: number): Timer => {
    const id = ++this.id as unknown as Timer;
    this.pending.set(id, { at: this.time + Math.max(1, Math.trunc(delay)), callback });
    return id;
  };
  clearTimeout = (id: Timer) => { this.pending.delete(id); };
  advance(ms: number): void {
    const end = this.time + ms;
    let callbacks = 0;
    while (true) {
      const first = [...this.pending].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > end) break;
      if (++callbacks > 10_000) throw new Error("Timer spin");
      this.time = Math.max(this.time, first[1].at);
      this.pending.delete(first[0]);
      first[1].callback();
    }
    this.time = end;
  }
}

async function harness(bpm = 118, countInEnabled = false, settings: Partial<ArpeggiatorConfig> = {}) {
  const clock = new Clock();
  const engine = new SimulatedHostEngine();
  expect((await engine.execute({ type: "configure", settings: { bpm, countInEnabled, loopMeasures: 1 } })).accepted).toBe(true);
  expect((await engine.execute({ type: "configure-drums", settings: { enabled: true } })).accepted).toBe(true);
  expect((await engine.execute({ type: "configure-arpeggiator", settings: { enabled: true, ...settings } })).accepted).toBe(true);
  const drums: { at: number; note: number }[] = [];
  const events: { at: number; position: number; event: MidiEvent }[] = [];
  const router = new PerformanceRouter();
  const loops = new MidiLoopScheduler(new SilentAudioOutput());
  const playback: TransportPlayback = new TransportPlayback(engine, {
    playDrum: (note) => { drums.push({ at: clock.now(), note }); },
  }, (event) => {
    // This is main's dispatchArpeggio -> dispatchPerformance capture path, including
    // its synchronous subscription reentry when advancing the engine at delivery.
    playback.advance();
    engine.markCaptureActivity();
    loops.record(event, engine.snapshot());
    events.push({ at: clock.now(), position: engine.snapshot().transport.progress, event });
  }, clock);
  const input = (event: MidiEvent) => {
    playback.advance();
    engine.dispatchMidi(event);
    for (const routed of router.route(event)) playback.handle(routed);
  };
  const note = (pitch = 60, channel = 2) => input({ type: "note-on", channel, note: pitch, velocity: 100 });
  const release = (pitch = 60, channel = 2) => input({ type: "note-off", channel, note: pitch });
  const tick = (ms: number) => {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      clock.advance(Math.min(50, end - clock.now()));
      playback.advance();
      loops.update(engine.snapshot());
    }
  };
  const ons = () => events.filter(({ event }) => event.type === "note-on");
  const command = (command: EngineCommand) => {
    if (command.type === "play" || command.type === "stop" || command.type === "configure" || command.type === "configure-arpeggiator") playback.advance();
    return executeLoopCommand(command, engine, loops, playback);
  };
  return { clock, engine, playback, events, drums, input, note, release, tick, ons, loops, command };
}

describe("production transport playback subscription", () => {
  it("reproduces the old lookahead's independent phase after off-cadence chord entry", () => {
    const arp = new MidiArpeggiator({ enabled: true, mode: "up", rate: "1/8", octaves: 1, gate: 0.5, latch: false, swing: 0 });
    arp.advanceScheduled(0.1, 118); // startup horizons before a held note
    arp.handle({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    const first = arp.advanceScheduled(0.05, 118).find(({ event }) => event.type === "note-on")!;
    const oldDelivery = 100 + first.delaySeconds * 1000;
    expect(Math.abs(oldDelivery - 30_000 / 118)).toBeGreaterThan(100);
  });

  it.each([118, 137])("aligns late-entered eighth notes with drums at %i BPM, across wraps and 50ms snapshots", async (bpm) => {
    const h = await harness(bpm);
    await h.engine.execute({ type: "play" });
    h.tick(73);
    h.note();
    expect(h.ons()).toEqual([]);
    h.tick(12_000);
    expect(h.ons().length).toBeGreaterThan(40);
    h.ons().forEach(({ at }, i) => {
      expect(Math.abs(at - (i + 1) * 30_000 / bpm)).toBeLessThanOrEqual(2);
      expect(Math.min(...h.drums.filter(({ note }) => note === 42).map((hit) => Math.abs(hit.at - at)))).toBeLessThanOrEqual(2);
    });
    h.playback.dispose();
    expect(h.clock.pending.size).toBe(0);
  });

  it.each([118, 137])("silences standalone notes during count-in and starts held notes with beat zero at %i BPM", async (bpm) => {
    const h = await harness(bpm, true);
    h.note();
    h.tick(71);
    expect(h.ons().length).toBeGreaterThan(0);
    await h.engine.execute({ type: "play" });
    const before = h.ons().length;
    const start = h.clock.now() + 4 * 60_000 / bpm;
    h.tick(Math.floor(start - h.clock.now()));
    expect(h.ons()).toHaveLength(before);
    expect(h.drums).toEqual([]);
    h.tick(2);
    expect(h.ons()).toHaveLength(before + 1);
    expect(Math.abs(h.ons().at(-1)!.at - start)).toBeLessThanOrEqual(2);
    expect(Math.abs(h.ons().at(-1)!.at - h.drums[0]!.at)).toBeLessThanOrEqual(2);
    h.playback.dispose();
  });

  it("reanchors stop/play while preserving stopped live playing", async () => {
    const h = await harness();
    h.note(); h.tick(83);
    await h.engine.execute({ type: "play" });
    expect(h.ons().at(-1)!.at).toBe(83);
    h.tick(700);
    await h.engine.execute({ type: "stop" });
    const stopped = h.ons().length;
    h.tick(400);
    expect(h.ons().length).toBeGreaterThan(stopped);
    const before = h.ons().length;
    await h.engine.execute({ type: "play" });
    expect(h.ons()).toHaveLength(before + 1);
    expect(h.ons().at(-1)!.at).toBe(h.drums.at(-1)!.at);
    h.playback.dispose();
  });

  it.each([120, 137].flatMap((bpm) => [2, 10, 30].flatMap((lateMs) => [false, true].map((retained) => ({ bpm, lateMs, retained })))))
    ("shares the count-in opening and following beats at $bpm BPM, $lateMs ms late, retained=$retained", async ({ bpm, lateMs, retained }) => {
      const h = await harness(bpm);
      h.note();
      if (retained) {
        expect((await h.command({ type: "play" })).accepted).toBe(true);
        h.tick(2_500);
        expect((await h.command({ type: "stop" })).accepted).toBe(true);
        expect(h.engine.snapshot().transport.cycle).toBeGreaterThan(0);
      }
      expect((await h.command({ type: "configure", settings: { countInEnabled: true } })).accepted).toBe(true);
      expect((await h.command({ type: "play" })).accepted).toBe(true);
      const cycle = h.engine.snapshot().transport.cycle;
      const before = h.ons().length;
      const drumsBefore = h.drums.length;
      const start = h.clock.now() + 4 * 60_000 / bpm;
      h.clock.time = start + lateMs;
      h.clock.advance(0);
      expect(h.engine.snapshot().transport).toMatchObject({ state: "playing", cycle });
      expect(h.ons()).toHaveLength(before + 1);
      expect(h.ons()[before]!.at).toBe(start + lateMs);
      expect(h.drums.slice(drumsBefore).map(({ at, note }) => [at, note])).toEqual([[start + lateMs, 36], [start + lateMs, 42]]);
      expect(h.ons()[before]!.position).toBeCloseTo(lateMs / (4 * 60_000 / bpm), 8);
      h.tick(2_000);
      const attacks = h.ons().slice(before);
      const hats = h.drums.slice(drumsBefore).filter(({ note }) => note === 42);
      expect(attacks.length).toBeGreaterThan(7);
      expect(hats).toHaveLength(attacks.length);
      attacks.forEach(({ at }, i) => {
        expect(Math.abs(at - hats[i]!.at)).toBeLessThanOrEqual(1);
        if (i > 0) expect(Math.abs(at - (start + i * 30_000 / bpm))).toBeLessThanOrEqual(2);
      });
      h.playback.dispose();
    });

  it.each([51, 173, 2_173])("does not treat a retained cycle after a %i ms count-in stall as a new opening", async (lateMs) => {
    const h = await harness(120);
    h.note();
    expect((await h.command({ type: "play" })).accepted).toBe(true);
    h.tick(2_500);
    expect((await h.command({ type: "stop" })).accepted).toBe(true);
    expect((await h.command({ type: "configure", settings: { countInEnabled: true } })).accepted).toBe(true);
    expect((await h.command({ type: "play" })).accepted).toBe(true);
    const count = h.ons().length;
    const drums = h.drums.length;
    const start = h.clock.now() + 2_000;
    h.clock.time = start + lateMs;
    h.clock.advance(0);
    expect(h.ons()).toHaveLength(count);
    expect(h.drums).toHaveLength(drums);
    h.tick(500);
    const firstDeadline = start + Math.ceil(lateMs / 250) * 250;
    expect(h.ons()[count]!.at).toBe(firstDeadline);
    expect(h.drums.slice(drums).filter(({ note }) => note === 42)[0]!.at).toBe(firstDeadline);
    h.playback.dispose();
  });

  it("clears recordings before delivering the new held-chord opening through the production command path", async () => {
    const h = await harness(120);
    h.note();
    expect((await h.command({ type: "play" })).accepted).toBe(true);
    h.tick(2_073);
    const oldTake = h.engine.snapshot().capture.staged!.id;
    expect(h.loops.exportRecordings([oldTake]).get(oldTake)!.some(({ event }) => event.type === "note-on")).toBe(true);
    const before = h.ons().length;
    const drumsBefore = h.drums.length;
    const staleCallbacks = [...h.clock.pending.values()].map(({ callback }) => callback);
    const clear = vi.spyOn(h.loops, "clearRecordings");
    const record = vi.spyOn(h.loops, "record");
    const duringPublish: number[] = [];
    const unsubscribe = h.engine.subscribe((snapshot) => {
      if (snapshot.settings.bpm === 137) duringPublish.push(h.ons().length);
    });

    expect((await h.command({ type: "configure", settings: { bpm: 137 }, clearAudio: true })).accepted).toBe(true);
    expect(duringPublish).toEqual([before]);
    expect(clear).toHaveBeenCalledTimes(1);
    const attackCall = record.mock.calls.findIndex(([event]) => event.type === "note-on");
    expect(attackCall).toBeGreaterThanOrEqual(0);
    expect(clear.mock.invocationCallOrder[0]!).toBeLessThan(record.mock.invocationCallOrder[attackCall]!);
    expect(h.ons()).toHaveLength(before + 1);
    expect(h.ons()[before]).toMatchObject({ at: 2_073, position: 0, event: { note: 60 } });
    expect(h.drums.slice(drumsBefore).map(({ at }) => at)).toEqual([2_073, 2_073]);
    expect(h.loops.hasCurrentRecording()).toBe(true);
    expect(h.loops.exportRecordings([oldTake]).size).toBe(0);
    staleCallbacks.forEach((callback) => callback());
    expect(h.ons()).toHaveLength(before + 1);

    unsubscribe();
    h.tick(Math.ceil(4 * 60_000 / 137));
    const snapshot = h.engine.snapshot();
    const take = snapshot.capture.staged!;
    const recording = h.loops.captureRecordings(snapshot, [take.id]).get(take.id)!;
    expect(recording.filter(({ event }) => event.type === "note-on")[0]).toEqual({ position: 0, event: { type: "note-on", channel: 2, note: 60, velocity: 100 } });
    h.ons().slice(before).forEach(({ at }, i) => {
      expect(Math.abs(at - (2_073 + i * 30_000 / 137))).toBeLessThanOrEqual(2);
      const hat = h.drums.slice(drumsBefore).filter(({ note }) => note === 42)[i]!;
      expect(Math.abs(at - hat.at)).toBeLessThanOrEqual(1);
    });
    h.playback.dispose();
  });

  it("finalizes and discards before Stop's standalone attack, then captures the same held note on Play", async () => {
    const h = await harness(120);
    h.note();
    expect((await h.command({ type: "play" })).accepted).toBe(true);
    h.tick(2_073);
    const stagedId = h.engine.snapshot().capture.staged!.id;
    const completed = h.loops.exportRecordings([stagedId]);
    const capture = vi.spyOn(h.loops, "captureRecordings");
    const discard = vi.spyOn(h.loops, "discardCurrentRecording");
    const record = vi.spyOn(h.loops, "record");
    const before = h.ons().length;
    expect((await h.command({ type: "stop" })).accepted).toBe(true);
    expect(capture.mock.calls[0]![0].transport.state).toBe("playing");
    expect(capture.mock.invocationCallOrder[0]!).toBeLessThan(discard.mock.invocationCallOrder[0]!);
    const standalone = record.mock.calls.findIndex(([event]) => event.type === "note-on");
    expect(standalone).toBeGreaterThanOrEqual(0);
    expect(discard.mock.invocationCallOrder[0]!).toBeLessThan(record.mock.invocationCallOrder[standalone]!);
    expect(record.mock.calls[standalone]![1].transport.state).toBe("stopped");
    expect(h.ons()).toHaveLength(before + 1);
    expect(h.loops.hasCurrentRecording()).toBe(false);
    expect(h.loops.exportRecordings([stagedId])).toEqual(completed);
    expect((await h.command({ type: "play" })).accepted).toBe(true);
    expect(h.ons()).toHaveLength(before + 2);
    expect(h.loops.hasCurrentRecording()).toBe(true);
    h.tick(2_001);
    const snapshot = h.engine.snapshot();
    expect(snapshot.capture.staged!.cycle).toBe(1);
    const recording = h.loops.captureRecordings(snapshot, [snapshot.capture.staged!.id]).get(snapshot.capture.staged!.id)!;
    expect(recording.find(({ event }) => event.type === "note-on")).toMatchObject({ position: 0, event: { note: 60 } });
    h.playback.dispose();
  });

  it("preserves recordings and deadlines on both host and engine timing rejections", async () => {
    const h = await harness(120);
    h.note();
    expect((await h.command({ type: "play" })).accepted).toBe(true);
    h.tick(73);
    expect(await h.command({ type: "configure", settings: { bpm: 137 } })).toMatchObject({ accepted: false, error: "Timing changes require clearAudio while a capture is in progress" });
    expect(h.loops.hasCurrentRecording()).toBe(true);
    h.tick(2_000);
    const stagedId = h.engine.snapshot().capture.staged!.id;
    const completed = h.loops.exportRecordings([stagedId]);
    expect((await h.command({ type: "stop" })).accepted).toBe(true);
    const before = h.ons().length;
    const clear = vi.spyOn(h.loops, "clearRecordings");
    const snapshot = h.engine.snapshot();
    expect(await h.command({ type: "configure", settings: { bpm: 137 } })).toMatchObject({ accepted: false, error: "Timing changes require clearAudio while takes exist" });
    // A rejected real-engine command inside a barrier must also rearm, not panic the chord.
    expect((await h.playback.transaction(() => h.engine.execute({ type: "configure", settings: { bpm: 137 } }))).accepted).toBe(false);
    expect(h.engine.snapshot()).toEqual(snapshot);
    expect(clear).not.toHaveBeenCalled();
    expect(h.loops.exportRecordings([stagedId])).toEqual(completed);
    expect(h.ons()).toHaveLength(before);
    h.tick(251);
    expect(h.ons()).toHaveLength(before + 1);
    expect(h.ons().at(-1)!.event).toMatchObject({ note: 60 });
    h.playback.dispose();
  });

  it("unwinds a failed asynchronous barrier without replaying consumed beats or losing gates", async () => {
    const h = await harness(120, false, { gate: 1 });
    h.note();
    expect((await h.command({ type: "play" })).accepted).toBe(true);
    h.tick(73);
    const before = h.ons().length;
    const drumsBefore = h.drums.length;
    const callbacks = [...h.clock.pending.values()].map(({ callback }) => callback);
    await expect(h.playback.transaction(async () => {
      expect(h.clock.pending.size).toBe(0);
      callbacks.forEach((callback) => callback());
      expect((await h.engine.execute({ type: "configure", settings: {} })).accepted).toBe(true);
      expect(h.ons()).toHaveLength(before);
      expect(h.drums).toHaveLength(drumsBefore);
      throw new Error("cleanup failed");
    })).rejects.toThrow("cleanup failed");
    h.tick(177);
    expect(h.ons()).toHaveLength(before + 1);
    expect(h.ons().at(-1)!.at).toBe(250);
    expect(h.events.slice(-2).map(({ event }) => event.type)).toEqual(["note-off", "note-on"]);
    expect(h.drums.at(-1)!.at).toBe(250);
    h.playback.dispose();
  });

  it("leaves non-clearing loop commands outside the playback barrier", async () => {
    const h = await harness(120);
    h.note();
    expect((await h.command({ type: "play" })).accepted).toBe(true);
    h.tick(2_073);
    const stagedId = h.engine.snapshot().capture.staged!.id;
    const completed = h.loops.exportRecordings([stagedId]);
    const transaction = vi.spyOn(h.playback, "transaction");
    const before = h.ons().length;
    for (const command of [
      { type: "configure", settings: {} },
      { type: "promote-staged" },
      { type: "delete-take", takeId: stagedId },
      { type: "undo-delete" },
    ] satisfies EngineCommand[]) expect((await h.command(command)).accepted).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
    expect(h.loops.exportRecordings([stagedId])).toEqual(completed);
    expect(h.engine.snapshot().promoted[0]!.id).toBe(stagedId);
    expect(h.ons()).toHaveLength(before);
    h.tick(177);
    expect(h.ons().at(-1)!.at).toBe(2_250);
    h.playback.dispose();
  });

  it("selects held notes at delivery, not at the previous 50ms lookahead", async () => {
    const h = await harness(120);
    await h.engine.execute({ type: "play" });
    h.tick(20); h.note(60);
    h.tick(220); h.release(60); h.note(67);
    h.tick(11);
    expect(h.ons().map(({ event }) => event)).toEqual([{ type: "note-on", channel: 2, note: 67, velocity: 100 }]);
    h.tick(230); h.release(67);
    h.tick(100);
    expect(h.ons()).toHaveLength(1);
    h.playback.dispose();
  });

  it.each(["1/4", "1/8", "1/16", "1/8T", "1/16T"] as const)("uses transport phase for %s, including quarter-beat triplet coincidences", async (rate) => {
    const h = await harness(137, false, { rate });
    h.note();
    await h.engine.execute({ type: "play" });
    const first = h.ons().length - 1;
    h.tick(3_000);
    const beats = { "1/4": 1, "1/8": 0.5, "1/16": 0.25, "1/8T": 1 / 3, "1/16T": 1 / 6 }[rate];
    const notes = h.ons().slice(first);
    notes.forEach(({ at }, i) => expect(Math.abs(at - i * beats * 60_000 / 137)).toBeLessThanOrEqual(2));
    for (let beat = 0; beat < 6; beat++) {
      const at = beat * 60_000 / 137;
      expect(Math.min(...notes.map((event) => Math.abs(event.at - at)))).toBeLessThanOrEqual(2);
      expect(Math.min(...h.drums.map((hit) => Math.abs(hit.at - at)))).toBeLessThanOrEqual(2);
    }
    h.playback.dispose();
  });

  it("shifts alternating swing notes without moving the quarter-beat anchor", async () => {
    const h = await harness(120, false, { swing: 0.5 });
    h.note(); await h.engine.execute({ type: "play" });
    const first = h.ons().length - 1;
    h.tick(1_000);
    expect(h.ons().slice(first).map(({ at }) => at)).toEqual([0, 375, 500, 875, 1000]);
    h.playback.dispose();
  });

  it("applies tempo/rate/swing/gate changes immediately, not on the next poll", async () => {
    const h = await harness(120, false, { gate: 1 });
    h.note(); expect((await h.engine.execute({ type: "play" })).accepted).toBe(true);
    h.tick(187);
    const staleCallbacks = [...h.clock.pending.values()].map(({ callback }) => callback);
    expect((await h.engine.execute({ type: "configure", settings: { bpm: 137 } })).accepted).toBe(true);
    expect((await h.engine.execute({ type: "configure-arpeggiator", settings: { rate: "1/16", swing: 0.5, gate: 0.5 } })).accepted).toBe(true);
    expect(h.engine.snapshot().transport.progress * 4).toBeCloseTo(0.4269833333, 8);
    const count = h.ons().length;
    staleCallbacks.forEach((callback) => callback());
    expect(h.ons()).toHaveLength(count);
    h.tick(300);
    const beat = 187 * 137 / 60_000;
    // Elapsed seconds are preserved: swung beat .375 has passed; beat .5 is at 218.98ms.
    const nextDeadline = 187 + (0.5 - beat) * 60_000 / 137;
    expect(Math.abs(h.ons()[count]!.at - nextDeadline)).toBeLessThanOrEqual(2);
    expect(h.drums.filter(({ note }) => note === 42).some(({ at }) => at === h.ons()[count]!.at)).toBe(true);
    expect(h.ons().slice(count).some(({ at }) => at === 250)).toBe(false);
    h.playback.dispose();
  });

  it("orders gate=1 same-pitch releases before the next attack and captures delivery time and routing", async () => {
    const h = await harness(118, false, { gate: 1 });
    await h.engine.execute({ type: "play" });
    h.tick(73); h.note(60, 3);
    h.input({ type: "pitch-bend", channel: 0, value: 2000 });
    h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
    h.tick(1_200);
    const notes = h.events.filter(({ event }) => event.type === "note-on" || event.type === "note-off");
    expect(notes.map(({ event }) => event.type)).toEqual(["note-on", "note-off", "note-on", "note-off", "note-on", "note-off", "note-on", "note-off", "note-on"]);
    notes.forEach(({ at, position, event }) => {
      expect(event.channel).toBe(3);
      expect(position).toBeCloseTo(at / (4 * 60_000 / 118), 8);
    });
    expect(h.events.find(({ event }) => event.type === "pitch-bend")!.event.channel).toBe(3);
    expect(h.events.find(({ event }) => event.type === "control-change")!.event.channel).toBe(3);
    h.tick(1_000);
    const snapshot = h.engine.snapshot();
    const recording = h.loops.captureRecordings(snapshot, [snapshot.capture.staged!.id]).get(snapshot.capture.staged!.id)!;
    expect(recording.find(({ event }) => event.type === "note-on")!.position).toBeCloseTo(notes[0]!.position, 8);
    h.playback.dispose();
  });

  it.each(["timer-first", "snapshot-first"])("skips stale attacks after a stall (%s) and releases the active gate", async (order) => {
    const h = await harness(118, false, { gate: 1 });
    h.note(); await h.engine.execute({ type: "play" });
    h.tick(80);
    const count = h.ons().length;
    h.clock.time = 3_173;
    if (order === "snapshot-first") h.playback.advance();
    h.clock.advance(0);
    if (order === "timer-first") h.playback.advance();
    expect(h.ons()).toHaveLength(count);
    expect(h.events.at(-1)!.event.type).toBe("note-off");
    h.tick(400);
    h.ons().slice(count).forEach(({ at }) => {
      expect(Math.abs(at - Math.round(at / (30_000 / 118)) * 30_000 / 118)).toBeLessThanOrEqual(2);
    });
    h.playback.dispose();
  });

  it.each(["panic", "suspend", "dispose"] as const)("invalidates queued callbacks and active gates on %s", async (action) => {
    const h = await harness();
    h.note(); await h.engine.execute({ type: "play" });
    const callbacks = [...h.clock.pending.values()].map(({ callback }) => callback);
    h.playback[action]();
    const count = h.events.length;
    const drums = h.drums.length;
    callbacks.forEach((callback) => callback());
    h.tick(2_000);
    expect(h.events).toHaveLength(count);
    expect(h.drums).toHaveLength(drums);
    expect(h.clock.pending.size).toBe(0);
    h.playback.dispose();
  });

  it("keeps latch and idle reset semantics while waiting on transport deadlines", async () => {
    const h = await harness(120, false, { latch: true });
    await h.engine.execute({ type: "play" });
    h.tick(10); h.note(60); h.note(67); h.release(60); h.release(67);
    h.tick(500);
    expect(h.ons().map(({ event }) => "note" in event ? event.note : null)).toEqual([60, 67]);
    await h.engine.execute({ type: "configure-arpeggiator", settings: { latch: false } });
    const count = h.ons().length;
    h.tick(700);
    expect(h.ons()).toHaveLength(count);
    h.note(67); h.note(60);
    h.tick(40);
    expect(h.ons().at(-1)!.event).toMatchObject({ note: 60 });
    h.playback.dispose();
  });

  it("preserves stopped sequence order across short gaps and resets after half a second idle", async () => {
    const h = await harness(120);
    h.note(60); h.note(67); h.release(60); h.release(67);
    h.tick(400);
    // Add the higher note first so the immediate stopped attack exposes the retained index.
    h.note(67); h.note(60);
    h.tick(250);
    expect(h.ons().at(-1)!.event).toMatchObject({ note: 60 });
    h.release(60); h.release(67);
    h.tick(600);
    h.note(60); h.note(67);
    expect(h.ons().at(-1)!.event).toMatchObject({ note: 60 });
    h.playback.dispose();
  });

  it("disables immediately and enables on the existing grid without replaying a consumed beat", async () => {
    const h = await harness(120);
    h.note(); await h.engine.execute({ type: "play" });
    h.tick(73);
    await h.engine.execute({ type: "configure-arpeggiator", settings: { enabled: false } });
    const count = h.ons().length;
    h.tick(10);
    await h.engine.execute({ type: "configure-arpeggiator", settings: { enabled: true } });
    h.note();
    h.tick(166);
    expect(h.ons()).toHaveLength(count);
    h.tick(1);
    expect(h.ons().at(-1)!.at).toBe(250);
    await h.engine.execute({ type: "configure-arpeggiator", settings: { gate: 1 } });
    expect(h.ons()).toHaveLength(count + 1);
    h.playback.dispose();
  });

  it("resumes after an import suspension without reviving old held notes or deadlines", async () => {
    const h = await harness(120);
    h.note();
    const callbacks = [...h.clock.pending.values()].map(({ callback }) => callback);
    h.playback.suspend();
    const count = h.ons().length;
    h.clock.advance(3_000);
    await h.engine.execute({ type: "configure-arpeggiator", settings: { rate: "1/16" } });
    h.playback.resume();
    callbacks.forEach((callback) => callback());
    h.tick(1_000);
    expect(h.ons()).toHaveLength(count);
    h.note(67);
    expect(h.ons().at(-1)!.at).toBe(4_000);
    await h.engine.execute({ type: "play" });
    h.tick(126);
    expect(h.ons().at(-1)!.at).toBe(4_125);
    h.playback.dispose();
  });

  it("rechecks early callbacks without selecting a note or losing the timer", async () => {
    const h = await harness(120);
    await h.engine.execute({ type: "play" });
    h.tick(73); h.note();
    const first = [...h.clock.pending.entries()].find(([, timer]) => timer.at === 250)!;
    h.clock.pending.delete(first[0]);
    first[1].callback();
    expect(h.ons()).toEqual([]);
    h.tick(177);
    expect(h.ons().map(({ at }) => at)).toEqual([250]);
    h.playback.dispose();
  });

  it.each([118, 137])("does not burst after a stalled count-in at %i BPM", async (bpm) => {
    const h = await harness(bpm, true);
    h.note(); await h.engine.execute({ type: "play" });
    const count = h.ons().length;
    h.clock.time = 4 * 60_000 / bpm + 173;
    h.clock.advance(0);
    expect(h.ons()).toHaveLength(count);
    expect(h.drums).toEqual([]);
    h.tick(500);
    h.ons().slice(count).forEach(({ at }) => {
      const relative = at - 4 * 60_000 / bpm;
      expect(Math.abs(relative - Math.round(relative / (30_000 / bpm)) * 30_000 / bpm)).toBeLessThanOrEqual(2);
    });
    h.playback.dispose();
  });

  it.each([
    { mode: "up", expected: [60, 64, 67, 60] },
    { mode: "down", expected: [67, 64, 60, 67] },
    { mode: "played", expected: [67, 60, 64, 67] },
    { mode: "up-down", expected: [60, 64, 67, 64] },
    { mode: "up-to-root-then-down", expected: [60, 64, 67, 72] },
  ] as const)("reuses $mode note selection on delivered deadlines", async ({ mode, expected }) => {
    const h = await harness(120, true, { mode });
    await h.engine.execute({ type: "play" });
    h.note(67); h.note(60); h.note(64);
    h.tick(2_751);
    expect(h.ons().map(({ event }) => "note" in event ? event.note : null)).toEqual(expected);
    h.playback.dispose();
  });

  it("gates each swung note relative to its own interval", async () => {
    const h = await harness(120, true, { gate: 0.5, swing: 0.5 });
    await h.engine.execute({ type: "play" });
    h.note(); h.tick(2_500);
    const notes = h.events.filter(({ event }) => event.type === "note-on" || event.type === "note-off");
    expect(notes.map(({ at, event }) => [at, event.type])).toEqual([
      [2000, "note-on"], [2188, "note-off"], [2375, "note-on"], [2438, "note-off"], [2500, "note-on"],
    ]);
    h.playback.dispose();
  });

  it("does not emit another attack when output synchronously stops transport", async () => {
    const clock = new Clock();
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: true, bpm: 120 } });
    await engine.execute({ type: "configure-drums", settings: { enabled: true } });
    await engine.execute({ type: "configure-arpeggiator", settings: { enabled: true } });
    const events: MidiEvent[] = [];
    let stopped = false;
    const playback = new TransportPlayback(engine, { playDrum: () => {
      if (!stopped) {
        stopped = true;
        void engine.execute({ type: "stop" });
      }
    } }, (event) => { events.push(event); }, clock);
    await engine.execute({ type: "play" });
    playback.handle({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    clock.advance(2_000);
    // One new standalone attack is allowed after Stop, but not an additional
    // attack from the interrupted playing deadline before that transition.
    expect(events.filter(({ type }) => type === "note-on")).toHaveLength(1);
    expect(engine.snapshot().transport.state).toBe("stopped");
    playback.dispose();
  });

  it.each([118, 137])("restarts held notes after count-in with a nonzero retained cycle at %i BPM", async (bpm) => {
    const h = await harness(bpm);
    h.note(); await h.engine.execute({ type: "play" });
    h.tick(2_500);
    expect(h.engine.snapshot().transport.cycle).toBeGreaterThan(0);
    await h.engine.execute({ type: "stop" });
    await h.engine.execute({ type: "configure", settings: { countInEnabled: true } });
    await h.engine.execute({ type: "play" });
    const count = h.ons().length;
    const drums = h.drums.length;
    const start = h.clock.now() + 4 * 60_000 / bpm;
    h.tick(Math.floor(start - h.clock.now()));
    expect(h.ons()).toHaveLength(count);
    expect(h.drums).toHaveLength(drums);
    h.tick(2);
    expect(h.ons()).toHaveLength(count + 1);
    expect(Math.abs(h.ons().at(-1)!.at - start)).toBeLessThanOrEqual(2);
    expect(Math.abs(h.drums[drums]!.at - h.ons().at(-1)!.at)).toBeLessThanOrEqual(2);
    h.playback.dispose();
  });
});
