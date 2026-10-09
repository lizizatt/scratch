import { afterEach, describe, expect, it } from "vitest";
import { SilentAudioOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import type { ArpeggiatorConfig } from "./arpeggiator.js";
import { executeLoopCommand } from "./loop-commands.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { applyVelocityCurve, PerformanceRouter } from "./performance-router.js";
import type { MonotonicClock } from "./transport-clock.js";
import { TransportPlayback } from "./transport-playback.js";

type Timer = ReturnType<typeof setTimeout>;
class Clock implements MonotonicClock {
  time = 0;
  private id = 0;
  private timers = new Map<Timer, { at: number; callback: () => void }>();
  now = () => this.time;
  setTimeout = (callback: () => void, delay: number): Timer => {
    const id = ++this.id as unknown as Timer;
    this.timers.set(id, { at: this.time + Math.max(1, Math.trunc(delay)), callback });
    return id;
  };
  clearTimeout = (id: Timer) => { this.timers.delete(id); };
  until(end: number): void {
    let count = 0;
    while (true) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      if (++count > 20_000) throw new Error("Timer spin");
      this.time = Math.max(this.time, next[1].at);
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = end;
  }
}

interface Delivery { at: number; event: MidiEvent }
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });

async function host(settings: Partial<ArpeggiatorConfig> = {}, bpm = 120, countInEnabled = false) {
  const clock = new Clock();
  const engine = new SimulatedHostEngine();
  await engine.execute({ type: "configure", settings: { bpm, loopMeasures: 1, countInEnabled, velocityCurve: "linear" } });
  await engine.execute({ type: "configure-arpeggiator", settings: { enabled: true, rate: "1/8", gate: 0.5, ...settings } });
  const live: Delivery[] = [];
  const replay: Delivery[] = [];
  const output: AudioOutput = new SilentAudioOutput();
  output.dispatchMidi = (event) => { replay.push({ at: clock.now(), event: structuredClone(event) }); };
  const loops = new MidiLoopScheduler(output);
  const router = new PerformanceRouter();
  const playback: TransportPlayback = new TransportPlayback(engine, output, (event, endsAtCycleBoundary) => {
    // main: dispatchArpeggio -> advanceTransportClock -> dispatchPerformance.
    playback.advance();
    engine.markCaptureActivity();
    loops.record(event, engine.snapshot(), endsAtCycleBoundary);
    live.push({ at: clock.now(), event: structuredClone(event) });
  }, clock, loops);
  cleanups.push(() => { playback.dispose(); void engine.dispose(); });
  const input = (event: MidiEvent) => {
    playback.advance();
    const curved = applyVelocityCurve(event, engine.snapshot().settings.velocityCurve);
    engine.dispatchMidi(curved);
    for (const routed of router.route(curved)) playback.handle(routed);
  };
  const command = async (command: EngineCommand) => {
    if (command.type === "play" || command.type === "stop" || command.type === "configure" || command.type === "configure-arpeggiator") playback.advance();
    expect((await executeLoopCommand(command, engine, loops, playback)).accepted).toBe(true);
  };
  // Keep the production 50ms poll independent of keyboard input and deadlines.
  const poll = () => {
    playback.advance();
    clock.setTimeout(poll, 50);
  };
  clock.setTimeout(poll, 50);
  return { engine, clock, loops, live, replay, input, command };
}

function normalized(deliveries: Delivery[], origin: number, level = 1) {
  return deliveries.map(({ at, event }) => ({
    at: at - origin,
    event: { ...event, channel: 0, ...(event.type === "note-on" ? { velocity: Math.round(event.velocity * level) } : {}) },
  }));
}

function expectFidelity(actual: Delivery[], expected: Delivery[], tolerance = 1.01): void {
  expect(actual.map(({ event }) => event)).toEqual(expected.map(({ event }) => event));
  actual.forEach(({ at }, index) => expect(Math.abs(at - expected[index]!.at), `delivery ${index}`).toBeLessThanOrEqual(tolerance));
}

describe("live arpeggio -> capture -> loop audio delivery", () => {
  it("replays the heard eighth-note gates, not 50ms polling gates, with quantization off by default", async () => {
    const h = await host();
    expect(h.engine.snapshot().capture.quantization).toBe("off");
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 103 });
    h.clock.until(1_900);
    h.input({ type: "note-off", channel: 0, note: 60 });
    const heard = normalized(h.live, 0, 0.8);
    expect(heard.slice(0, 2).map(({ at }) => at)).toEqual([0, 125]);
    h.clock.until(2_000);
    const take = h.engine.snapshot().capture.staged!;
    const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
    expect(recording.map(({ position, event }) => ({ at: Math.round(position * 2_000), event })))
      .toEqual(h.live);
    h.clock.until(3_950);
    const replayed = normalized(h.replay, 2_000);
    expect(replayed.map(({ event }) => event)).toEqual(heard.map(({ event }) => event));
    replayed.forEach(({ at }, index) => expect(Math.abs(at - heard[index]!.at)).toBeLessThanOrEqual(1));
  });

  it.each([118, 137].flatMap((bpm) => (["1/4", "1/8", "1/16", "1/8T", "1/16T"] as const)
    .flatMap((rate) => [0.1, 0.5, 1].flatMap((gate) => [0, 0.35].map((swing) => ({ bpm, rate, gate, swing }))))))
    ("preserves staged/promoted $rate notes and gates at $bpm BPM, gate=$gate, swing=$swing", async ({ bpm, rate, gate, swing }) => {
      const h = await host({ rate, gate, swing }, bpm);
      await h.command({ type: "play" });
      for (const [note, velocity] of [[60, 53], [64, 103], [67, 87]]) h.input({ type: "note-on", channel: 2, note: note!, velocity: velocity! });
      const duration = 240_000 / bpm;
      h.clock.until(duration - 3);
      for (const note of [60, 64, 67]) h.input({ type: "note-off", channel: 2, note });
      h.clock.until(Math.ceil(duration) + 2);
      const snapshot = h.engine.snapshot();
      const take = snapshot.capture.staged!;
      const recorded = h.loops.exportRecordings([take.id]).get(take.id)!;
      const heard = h.live.filter(({ at }) => at < duration);
      // A gate touching the edge is closed by the loop's terminal release.
      const expected = [...heard];
      if (expected.at(-1)!.event.type === "note-on") expected.push({ at: duration, event: { type: "note-off", channel: 2, note: (expected.at(-1)!.event as Extract<MidiEvent, { type: "note-on" }>).note } });
      expectFidelity(recorded.map(({ position, event }) => ({ at: position * duration, event })), expected);
      if (gate === 0.5) await h.command({ type: "promote-staged" });
      // Stop input entirely: replay must not borrow arp wake-ups to retain its gates.
      h.clock.until(Math.ceil(2 * duration) + 2);
      // The rollover also starts the following loop; compare the completed one,
      // including its terminal release but not the next cycle's opening.
      const replay = h.replay.slice(0, expected.length);
      expect(h.replay.slice(expected.length).every(({ at }) => at >= 2 * duration)).toBe(true);
      expectFidelity(normalized(replay, duration), normalized(expected, 0, take.level), 2.01);
    });

  it("does not add a zero-length carried note when a full gate releases exactly at rollover", async () => {
    const h = await host({ gate: 1 });
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 103 });
    h.clock.until(2_100);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(4_001);
    const take = h.engine.snapshot().capture.staged!;
    expect(take.cycle).toBe(1);
    const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
    expectFidelity(recording.map(({ position, event }) => ({ at: position * 2_000, event })), [
      { at: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 103 } },
      { at: 250, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
  });

  it("keeps a late arpeggio's quantized release at the closing boundary, after its attack", async () => {
    const h = await host({ rate: "1/4", gate: 0.75 });
    await h.command({ type: "set-quantization", mode: "1/4" });
    await h.command({ type: "play" });
    h.clock.until(1_450);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 103 });
    h.clock.until(1_600);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(2_001);
    expect(normalized(h.live, 0).map(({ at }) => at)).toEqual([1_500, 1_875]);
    const take = h.engine.snapshot().capture.staged!;
    expect(h.loops.exportRecordings([take.id]).get(take.id)).toEqual([
      { position: 0.75, event: { type: "note-on", channel: 0, note: 60, velocity: 103 } },
      { position: 1, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
    h.clock.until(4_001);
    expectFidelity(normalized(h.replay, 2_000), [
      { at: 1_500, event: { type: "note-on", channel: 0, note: 60, velocity: 82 } },
      { at: 2_000, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
  });

  it("moves a terminal gate with an attack quantized across the circular boundary", async () => {
    const h = await host({ rate: "1/16", gate: 1 });
    await h.command({ type: "set-quantization", mode: "1/4" });
    await h.command({ type: "play" });
    h.clock.until(1_850);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 103 });
    h.clock.until(1_900);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(2_001);
    const take = h.engine.snapshot().capture.staged!;
    expect(h.loops.exportRecordings([take.id]).get(take.id)).toEqual([
      { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 103 } },
      { position: 0.25, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
    h.clock.until(2_600);
    expectFidelity(normalized(h.replay, 2_000), [
      { at: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 82 } },
      { at: 500, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
  });

  it("keeps positive gates when repeated arp pitches collapse onto a coarser circular grid", async () => {
    const h = await host({ rate: "1/16", gate: 0.5 });
    await h.command({ type: "set-quantization", mode: "1/4" });
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 103 });
    h.clock.until(1_975);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(3_999);
    const events = normalized(h.replay, 2_000);
    const attacks = events.filter(({ event }) => event.type === "note-on");
    expect(attacks).toHaveLength(4);
    attacks.forEach(({ at }, index) => expect(Math.abs(at - [0, 500, 1_000, 1_500][index]!)).toBeLessThanOrEqual(1));
    let attack: number | null = null;
    for (const { at, event } of events) {
      if (event.type === "note-on") {
        expect(attack).toBeNull();
        attack = at;
      } else if (event.type === "note-off" && attack !== null) {
        expect(at - attack).toBeGreaterThan(0);
        attack = null;
      }
    }
  });

  it.each([0, 2, 10, 30])("captures and replays the first count-in beat with a %i ms late callback", async (lateness) => {
    const h = await host({ rate: "1/8T", swing: 0.3, gate: 0.4 }, 120, true);
    await h.command({ type: "play" });
    h.clock.until(73);
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 103 });
    h.clock.until(1_950);
    expect(h.live).toEqual([]);
    h.clock.time = 2_000 + lateness;
    h.clock.until(2_000 + lateness);
    expect(h.live[0]).toEqual({ at: 2_000 + lateness, event: { type: "note-on", channel: 2, note: 60, velocity: 103 } });
    h.clock.until(3_900);
    h.input({ type: "note-off", channel: 2, note: 60 });
    h.clock.until(4_001);
    const take = h.engine.snapshot().capture.staged!;
    const recorded = h.loops.exportRecordings([take.id]).get(take.id)!;
    expectFidelity(recorded.map(({ position, event }) => ({ at: 2_000 + position * 2_000, event })), h.live);
    h.clock.until(5_999);
    expectFidelity(normalized(h.replay, 4_000), normalized(h.live, 2_000, take.level));
  });

  it("retains genuinely held notes through rollover and releases them during staged replay", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "play" });
    h.clock.until(1_900);
    h.input({ type: "note-on", channel: 2, note: 67, velocity: 87 });
    h.clock.until(2_100);
    h.input({ type: "note-off", channel: 2, note: 67 });
    h.clock.until(4_001);
    const take = h.engine.snapshot().capture.staged!;
    const recorded = h.loops.exportRecordings([take.id]).get(take.id)!;
    expectFidelity(recorded.map(({ position, event }) => ({ at: position * 2_000, event })), [
      { at: 0, event: { type: "note-on", channel: 2, note: 67, velocity: 87 } },
      { at: 100, event: { type: "note-off", channel: 2, note: 67 } },
    ]);
    h.clock.until(4_200);
    expectFidelity(normalized(h.replay.filter(({ at }) => at >= 4_000), 4_000).slice(-2), [
      { at: 0, event: { type: "note-on", channel: 0, note: 67, velocity: 70 } },
      { at: 100, event: { type: "note-off", channel: 0, note: 67 } },
    ]);
  });

  it("replays previous-staged promotion unchanged after a quantization edit, at unity level", async () => {
    const h = await host({ gate: 0.3, swing: 0.35 });
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 103 });
    h.clock.until(1_900);
    h.input({ type: "note-off", channel: 2, note: 60 });
    const original = structuredClone(h.live);
    h.clock.until(2_017);
    const id = h.engine.snapshot().capture.staged!.id;
    const captured = h.loops.exportRecordings([id]);
    h.input({ type: "note-on", channel: 2, note: 67, velocity: 87 });
    h.clock.until(3_900);
    h.input({ type: "note-off", channel: 2, note: 67 });
    h.clock.until(4_050);
    expect(h.engine.snapshot().capture.previousStaged!.id).toBe(id);
    await h.command({ type: "promote-previous-staged" });
    await h.command({ type: "set-staged-audible", audible: false });
    await h.command({ type: "set-take-level", takeId: id, level: 1 });
    await h.command({ type: "set-quantization", mode: "1/4" });
    await h.command({ type: "configure-arpeggiator", settings: { enabled: false } });
    expect(h.loops.exportRecordings([id])).toEqual(captured);
    h.clock.until(7_999);
    expectFidelity(normalized(h.replay.filter(({ at }) => at >= 6_000), 6_000), normalized(original, 0));
    await h.command({ type: "stop" });
    const count = h.replay.length;
    h.clock.until(9_000);
    expect(h.replay).toHaveLength(count);
  });

  it("records routed velocity once and preserves it on replay", async () => {
    const h = await host();
    await h.command({ type: "configure", settings: { velocityCurve: "strong" } });
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 50 });
    h.clock.until(100);
    h.input({ type: "note-off", channel: 2, note: 60 });
    h.clock.until(2_500);
    expect(h.live[0]!.event).toEqual({ type: "note-on", channel: 2, note: 60, velocity: 85 });
    expectFidelity(normalized(h.replay, 2_000), normalized(h.live, 0, 0.8));
  });

  it("retains the new opening after clearAudio through synchronous boundary subscribers", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 103 });
    h.clock.until(2_073);
    const old = h.engine.snapshot().capture.staged!.id;
    await h.command({ type: "configure", settings: { bpm: 137 }, clearAudio: true });
    expect(h.loops.exportRecordings([old]).size).toBe(0);
    const start = h.clock.now();
    const duration = 240_000 / 137;
    h.clock.until(start + duration - 3);
    h.input({ type: "note-off", channel: 2, note: 60 });
    h.clock.until(Math.ceil(start + duration) + 2);
    const take = h.engine.snapshot().capture.staged!;
    expect(h.loops.exportRecordings([take.id]).get(take.id)!.find(({ event }) => event.type === "note-on"))
      .toEqual({ position: 0, event: { type: "note-on", channel: 2, note: 60, velocity: 103 } });
    h.clock.until(start + 2 * duration - 1);
    expectFidelity(normalized(h.replay.filter(({ at }) => at >= start + duration), start + duration),
      normalized(h.live.filter(({ at }) => at >= start), start, 0.8), 2.01);
  });

  it("retains undoable audio when a command publication delivers an overdue arpeggio synchronously", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 103 });
    h.clock.until(2_073);
    const id = h.engine.snapshot().capture.staged!.id;
    await h.command({ type: "promote-staged" });
    const recorded = h.loops.exportRecordings([id]);
    h.clock.time = 2_250;
    await h.command({ type: "delete-take", takeId: id });
    await h.command({ type: "undo-delete" });
    expect(h.loops.exportRecordings([id])).toEqual(recorded);
    h.input({ type: "note-off", channel: 2, note: 60 });
    await h.command({ type: "set-staged-audible", audible: false });
    h.clock.until(5_999);
    expectFidelity(normalized(h.replay.filter(({ at }) => at >= 4_000), 4_000),
      normalized(h.live.filter(({ at }) => at < 2_000), 0, 0.8));
  });
});
