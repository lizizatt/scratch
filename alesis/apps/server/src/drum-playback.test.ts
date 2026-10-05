import { describe, expect, it, vi } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import type { EngineSnapshot } from "@alesis/protocol";
import { DrumPlaybackScheduler, type DrumPlaybackClock } from "./drum-playback.js";
import { drumPatternAtStep, DrumPatternScheduler } from "./drum-patterns.js";

type Timer = ReturnType<typeof setTimeout>;

// Node-like integer timers, with independent control of elapsed time and callback delivery.
class FakeClock implements DrumPlaybackClock {
  time = 0;
  private nextId = 0;
  readonly pending = new Map<Timer, { deadline: number; callback: () => void }>();
  readonly delays: number[] = [];
  maximumPending = 0;

  now = (): number => this.time;
  setTimeout = (callback: () => void, delayMs: number): Timer => {
    const timer = ++this.nextId as unknown as Timer;
    this.delays.push(delayMs);
    this.pending.set(timer, { deadline: this.time + Math.max(1, Math.trunc(delayMs)), callback });
    this.maximumPending = Math.max(this.maximumPending, this.pending.size);
    return timer;
  };
  clearTimeout = (timer: Timer): void => { this.pending.delete(timer); };

  advance(ms: number): void {
    const target = this.time + ms;
    let callbacks = 0;
    while (true) {
      const first = [...this.pending].sort((left, right) => left[1].deadline - right[1].deadline)[0];
      if (!first || first[1].deadline > target) break;
      if (++callbacks > 10_000) throw new Error("Timer failed to make progress");
      this.time = Math.max(this.time, first[1].deadline);
      this.pending.delete(first[0]);
      first[1].callback();
    }
    this.time = target;
  }

  queuedCallback(): () => void {
    const first = [...this.pending.values()][0];
    if (!first) throw new Error("Expected one pending drum timer");
    return first.callback;
  }

  fireEarly(): void {
    const first = [...this.pending][0];
    if (!first) throw new Error("Expected one pending drum timer");
    this.pending.delete(first[0]);
    first[1].callback();
  }
}

function snapshotAt(ms: number, bpm = 120, beatsPerMeasure = 4, loopMeasures = 1): EngineSnapshot {
  const snapshot = new SimulatedHostEngine().snapshot();
  Object.assign(snapshot.settings, { bpm, beatsPerMeasure, loopMeasures, countInEnabled: false });
  snapshot.drums = { enabled: true, pattern: "four-on-floor", volume: 0.8 };
  const position = ms / (60_000 / bpm * beatsPerMeasure * loopMeasures);
  snapshot.transport = { state: "playing", cycle: Math.floor(position), progress: position % 1 };
  return snapshot;
}

function harness() {
  const clock = new FakeClock();
  const hits: { time: number; note: number; velocity: number }[] = [];
  const audio = { playDrum: vi.fn((note: number, velocity: number) => { hits.push({ time: clock.now(), note, velocity }); }) };
  const drums = new DrumPlaybackScheduler(audio, clock);
  return { clock, hits, audio, drums };
}

function expectedHits(snapshot: EngineSnapshot, firstStep: number, lastStep: number) {
  const steps = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures * 4;
  return Array.from({ length: Math.max(0, lastStep - firstStep + 1) }, (_, index) => firstStep + index)
    .flatMap((step) => drumPatternAtStep(snapshot, step % steps).map((hit) => ({ ...hit, step })));
}

function intervalErrors(times: number[], interval: number): number[] {
  return times.slice(1).map((time, index) => Math.abs(time - times[index]! - interval));
}

describe("DrumPlaybackScheduler", () => {
  it.each([118, 137])("keeps hats within 2 ms at %i BPM with real engine snapshots every 50 ms", async (bpm) => {
    const { clock, drums, hits } = harness();
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "configure-drums", settings: { enabled: true, pattern: "four-on-floor", volume: 0.8 } });
    const unsubscribe = engine.subscribe((snapshot) => drums.update(snapshot));
    await engine.execute({ type: "play" });
    const initial = engine.snapshot();
    for (let tick = 0; tick < 240; tick += 1) {
      clock.advance(50);
      engine.advance(0.05);
      // Non-transport publications must not move the clock or replay a step.
      await engine.execute({ type: "configure", settings: {} });
    }
    const hatTimes = hits.filter(({ note }) => note === 42).map(({ time }) => time);
    expect(hatTimes.length).toBeGreaterThan(40);
    expect(Math.max(...intervalErrors(hatTimes, 30_000 / bpm))).toBeLessThanOrEqual(2);
    const expected = expectedHits(initial, 0, Math.floor(12_000 / (15_000 / bpm)));
    expect(hits.map(({ note, velocity }) => ({ note, velocity }))).toEqual(expected.map(({ step: _step, ...hit }) => hit));
    hits.forEach((hit, index) => {
      const deadline = expected[index]!.step * 15_000 / bpm;
      expect(hit.time - deadline).toBeGreaterThanOrEqual(-0.001);
      expect(hit.time - deadline).toBeLessThanOrEqual(2);
    });
    expect(engine.snapshot().engine.midiEventsReceived).toBe(initial.engine.midiEventsReceived);
    expect(engine.snapshot().capture.hasCurrentEvents).toBe(false);
    expect(clock.maximumPending).toBe(1);
    expect(clock.delays.every((delay) => Number.isInteger(delay) && delay >= 1)).toBe(true);
    unsubscribe();
    drums.dispose();
    await engine.dispose();
  });

  it("demonstrates the old direct 50 ms scheduler fails the same hat interval criterion", () => {
    const old = new DrumPatternScheduler();
    const hats: number[] = [];
    for (let time = 0; time <= 12_000; time += 50) {
      for (const hit of old.update(snapshotAt(time, 118))) if (hit.note === 42) hats.push(time);
    }
    const intervals = hats.slice(1).map((time, index) => time - hats[index]!);
    expect(intervals).toContain(250);
    expect(intervals).toContain(300);
    expect(Math.max(...intervalErrors(hats, 30_000 / 118))).toBeGreaterThan(2);
  });

  it.each(["four-on-floor", "backbeat", "breakbeat"] as const)("matches every generated %s hit across loop wraps", (pattern) => {
    const { clock, drums, hits } = harness();
    const initial = snapshotAt(0, 137, 3, 2);
    initial.drums.pattern = pattern;
    drums.update(initial);
    for (let time = 50; time <= 12_000; time += 50) {
      clock.advance(50);
      const snapshot = snapshotAt(time, 137, 3, 2);
      snapshot.drums.pattern = pattern;
      drums.update(snapshot);
    }
    const expected = expectedHits(initial, 0, Math.floor(12_000 / (15_000 / 137)));
    expect(hits.map(({ time: _time, ...hit }) => hit)).toEqual(expected.map(({ step: _step, ...hit }) => hit));
    expect(clock.maximumPending).toBe(1);
  });

  it("plays grid zero immediately and never duplicates exact cycle boundaries", () => {
    const { clock, drums, hits } = harness();
    drums.update(snapshotAt(0));
    expect(hits).toEqual(drumPatternAtStep(snapshotAt(0), 0).map((hit) => ({ ...hit, time: 0 })));
    for (let time = 50; time <= 6_000; time += 50) {
      clock.advance(50);
      drums.update(snapshotAt(time));
      drums.update(snapshotAt(time));
    }
    for (const boundary of [0, 2_000, 4_000, 6_000]) {
      expect(hits.filter(({ time }) => time === boundary)).toHaveLength(2);
    }
  });

  it.each(["stop", "count-in", "disable", "volume-zero"])("cancels queued hits on %s without waiting for another tick", (action) => {
    const { clock, drums, hits } = harness();
    drums.update(snapshotAt(0));
    clock.advance(200);
    const staleCallback = clock.queuedCallback();
    const snapshot = snapshotAt(200);
    if (action === "stop") snapshot.transport.state = "stopped";
    if (action === "count-in") snapshot.transport.state = "counting-in";
    if (action === "disable") snapshot.drums.enabled = false;
    if (action === "volume-zero") snapshot.drums.volume = 0;
    drums.update(snapshot);
    const count = hits.length;
    expect(clock.pending.size).toBe(0);
    staleCallback();
    clock.advance(5_000);
    expect(hits).toHaveLength(count);
  });

  it.each(["enabled", "volume"] as const)("waits for the next grid when %s becomes audible halfway through a step", (field) => {
    const { clock, drums, hits } = harness();
    const initial = snapshotAt(0);
    if (field === "enabled") initial.drums.enabled = false;
    else initial.drums.volume = 0;
    drums.update(initial);
    clock.advance(312.5);
    drums.update(snapshotAt(312.5));
    expect(hits).toEqual([]);
    clock.advance(187.4);
    expect(hits).toEqual([]);
    clock.advance(1);
    expect(hits.map(({ time }) => time)).toEqual([500.5, 500.5, 500.5]);
    expect(hits.map(({ time: _time, ...hit }) => hit)).toEqual(drumPatternAtStep(snapshotAt(0), 4));
  });

  it("does not replay a consumed boundary on enable or configuration changes", () => {
    const { drums, hits } = harness();
    const snapshot = snapshotAt(0);
    drums.update(snapshot);
    snapshot.drums.enabled = false;
    drums.update(snapshot);
    snapshot.drums.enabled = true;
    drums.update(snapshot);
    snapshot.drums.volume = 1;
    drums.update(snapshot);
    snapshot.drums.pattern = "backbeat";
    drums.update(snapshot);
    expect(hits).toHaveLength(2);
  });

  const changes: { name: string; change: (snapshot: EngineSnapshot) => void }[] = [
    { name: "pattern", change: (snapshot) => { snapshot.drums.pattern = "breakbeat"; } },
    { name: "BPM", change: (snapshot) => { snapshot.settings.bpm = 137; } },
    { name: "meter", change: (snapshot) => { snapshot.settings.beatsPerMeasure = 3; } },
    { name: "loop length", change: (snapshot) => { snapshot.settings.loopMeasures = 2; } },
    { name: "volume", change: (snapshot) => { snapshot.drums.volume = 0.3; } },
    { name: "drumkit", change: (snapshot) => { snapshot.pads.selectedDrumKitId = "drum:128:8"; } },
    { name: "synth", change: (snapshot) => { snapshot.synth.selectedId = "soundfont"; } },
    { name: "SoundFont", change: (snapshot) => { snapshot.synth.selectedSoundFontId = "replacement"; } },
    { name: "preset", change: (snapshot) => { snapshot.synth.selectedSoundFontPresetId = "0:8"; } },
    { name: "output", change: (snapshot) => { snapshot.settings.audioOutputId = "replacement"; } },
  ];
  it.each(changes)("discards the old queued event on $name change and follows the new grid", ({ change }) => {
    const { clock, drums, hits } = harness();
    drums.update(snapshotAt(0));
    clock.advance(187.5);
    const staleCallback = clock.queuedCallback();
    const snapshot = snapshotAt(187.5);
    change(snapshot);
    const count = hits.length;
    drums.update(snapshot, clock.now());
    staleCallback();
    clock.advance(1_600);
    const steps = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures * 4;
    const position = (snapshot.transport.cycle + snapshot.transport.progress) * steps;
    const stepMs = 15_000 / snapshot.settings.bpm;
    const expected = expectedHits(snapshot, Math.ceil(position), Math.floor(position + 1_600 / stepMs));
    const after = hits.slice(count);
    expect(after.map(({ time: _time, ...hit }) => hit)).toEqual(expected.map(({ step: _step, ...hit }) => hit));
    after.forEach(({ time }, index) => {
      const deadline = 187.5 + (expected[index]!.step - position) * stepMs;
      expect(time).toBeGreaterThanOrEqual(deadline - 0.001);
      expect(time - deadline).toBeLessThanOrEqual(1.001);
    });
    expect(clock.maximumPending).toBe(1);
  });

  it("uses the engine timestamp for off-cadence configuration publications", () => {
    const { clock, drums, hits } = harness();
    drums.update(snapshotAt(0));
    clock.advance(200);
    drums.update(snapshotAt(200), 200);
    clock.advance(37);
    const snapshot = snapshotAt(200);
    snapshot.drums.volume = 1;
    drums.update(snapshot, 200);
    expect(hits).toHaveLength(2);
    clock.advance(13);
    expect(hits.at(-1)).toEqual({ time: 250, note: 42, velocity: 95 });
  });

  it("does not reanchor unchanged positions on unrelated publications", () => {
    const { clock, drums, hits } = harness();
    const snapshot = snapshotAt(0, 118);
    drums.update(snapshot);
    for (let i = 0; i < 30; i += 1) {
      clock.advance(10);
      drums.update(snapshot);
    }
    expect(hits.filter(({ note }) => note === 42).map(({ time }) => time)).toEqual([0, 255]);
  });

  it("allows stop and replay at the same position, including synchronous subscriptions", async () => {
    const { clock, drums, hits } = harness();
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120 } });
    await engine.execute({ type: "configure-drums", settings: { enabled: true } });
    const unsubscribe = engine.subscribe((snapshot) => drums.update(snapshot));
    await engine.execute({ type: "play" });
    expect(hits).toHaveLength(2);
    await engine.execute({ type: "stop" });
    expect(clock.pending.size).toBe(0);
    await engine.execute({ type: "play" });
    expect(hits).toHaveLength(4);
    clock.advance(250);
    expect(hits).toHaveLength(5);
    unsubscribe();
    drums.dispose();
    await engine.dispose();
  });

  it("stays silent throughout count-in and starts at the authoritative playing boundary", () => {
    const { clock, drums, hits } = harness();
    const snapshot = snapshotAt(0);
    snapshot.transport.state = "counting-in";
    drums.update(snapshot);
    clock.advance(2_000);
    expect(hits).toEqual([]);
    expect(clock.pending.size).toBe(0);
    drums.update(snapshotAt(0));
    expect(hits.map(({ time }) => time)).toEqual([2_000, 2_000]);
  });

  it.each([118, 137])("preserves the opening hits after real engine count-in at %i BPM", async (bpm) => {
    const { clock, drums, hits } = harness();
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: true, bpm, beatsPerMeasure: 4 } });
    await engine.execute({ type: "configure-drums", settings: { enabled: true } });
    const unsubscribe = engine.subscribe((snapshot) => drums.update(snapshot, clock.now()));
    await engine.execute({ type: "play" });
    while (engine.snapshot().transport.state === "counting-in") {
      expect(hits).toEqual([]);
      clock.advance(50);
      engine.advance(0.05);
    }
    expect(hits.map(({ note }) => note)).toEqual([36, 42]);
    const openingTime = clock.now();
    for (let i = 0; i < 80; i++) { clock.advance(50); engine.advance(0.05); }
    const hats = hits.filter(({ note }) => note === 42);
    expect(hats[0]!.time).toBe(openingTime);
    const exactStart = 4 * 60_000 / bpm;
    hats.slice(1).forEach((hit, i) => expect(Math.abs(hit.time - (exactStart + (i + 1) * 30_000 / bpm))).toBeLessThanOrEqual(2));
    unsubscribe(); drums.dispose(); await engine.dispose();
  });

  it("does not replay count-in's opening after a long stall", () => {
    const { clock, drums, hits } = harness();
    const snapshot = snapshotAt(0);
    snapshot.transport.state = "counting-in";
    drums.update(snapshot);
    clock.time = 2300;
    drums.update(snapshotAt(300));
    expect(hits).toEqual([]);
  });

  it("resets identity on a backward transport/clear without reviving the old timer", () => {
    const { clock, drums, hits } = harness();
    drums.update(snapshotAt(0));
    clock.advance(2_200);
    drums.update(snapshotAt(2_200));
    const staleCallback = clock.queuedCallback();
    const count = hits.length;
    drums.update(snapshotAt(0));
    staleCallback();
    expect(hits.slice(count).map(({ time }) => time)).toEqual([2_200, 2_200]);
    clock.advance(250);
    expect(hits.at(-1)).toMatchObject({ time: 2_450, note: 42 });
  });

  it.each(["timer-first", "snapshot-first"])("skips a severe stall without a burst (%s)", (order) => {
    const { clock, drums, hits } = harness();
    drums.update(snapshotAt(0, 118));
    clock.advance(100);
    const count = hits.length;
    // The event loop was blocked, but the monotonic clock continued to advance.
    clock.time += 3_100;
    if (order === "snapshot-first") drums.update(snapshotAt(clock.now(), 118));
    clock.advance(0);
    if (order === "timer-first") drums.update(snapshotAt(clock.now(), 118));
    expect(hits).toHaveLength(count);
    const stepMs = 15_000 / 118;
    const nextStep = Math.ceil(clock.now() / stepMs);
    const nextDeadline = nextStep * stepMs;
    clock.advance(Math.floor(nextDeadline - clock.now()));
    expect(hits).toHaveLength(count);
    clock.advance(1);
    expect(hits.length).toBeGreaterThan(count);
    expect(hits.slice(count).map(({ time: _time, ...hit }) => hit)).toEqual(drumPatternAtStep(snapshotAt(0, 118), nextStep % 16));
    expect(hits.slice(count).every(({ time }) => Math.abs(time - nextDeadline) <= 1)).toBe(true);
    expect(clock.maximumPending).toBe(1);
  });

  it("rechecks an early callback with an integer positive delay and no early note", () => {
    const { clock, drums, hits } = harness();
    drums.update(snapshotAt(0, 118));
    clock.advance(254);
    const count = hits.length;
    clock.fireEarly();
    expect(hits).toHaveLength(count);
    expect(clock.delays.at(-1)).toBe(1);
    expect(clock.pending.size).toBe(1);
    clock.advance(1);
    expect(hits.at(-1)).toMatchObject({ time: 255, note: 42 });
  });

  it("allows sub-millisecond snapshot publication drift without omitting grid zero", () => {
    const { clock, drums, hits } = harness();
    clock.time = 0.4;
    drums.update(snapshotAt(0, 118), 0);
    expect(hits.map(({ time }) => time)).toEqual([0.4, 0.4]);
    clock.advance(300);
    const hats = hits.filter(({ note }) => note === 42).map(({ time }) => time);
    expect(Math.max(...intervalErrors(hats, 30_000 / 118))).toBeLessThanOrEqual(2);
  });

  it("does not lose a due hit when the engine snapshot runs before a slightly late timer", () => {
    const { clock, drums, hits } = harness();
    drums.update(snapshotAt(0));
    clock.advance(200);
    clock.time = 250.5;
    drums.update(snapshotAt(250.5));
    clock.advance(0);
    expect(hits.filter(({ note }) => note === 42).map(({ time }) => time)).toEqual([0, 250.5]);
  });

  it("stops a multi-hit boundary if output synchronously resets playback", () => {
    const clock = new FakeClock();
    let drums: DrumPlaybackScheduler;
    const audio = { playDrum: vi.fn(() => drums.reset()) };
    drums = new DrumPlaybackScheduler(audio, clock);
    drums.update(snapshotAt(0));
    expect(audio.playDrum).toHaveBeenCalledTimes(1);
    expect(clock.pending.size).toBe(0);
  });

  it("reset cancels for panic/import and follows a replacement audio proxy only after resync", () => {
    const clock = new FakeClock();
    const first = { playDrum: vi.fn() };
    const replacement = { playDrum: vi.fn() };
    let current = first;
    const drums = new DrumPlaybackScheduler({ playDrum: (note, velocity) => current.playDrum(note, velocity) }, clock);
    drums.update(snapshotAt(0));
    const staleCallback = clock.queuedCallback();
    drums.reset();
    current = replacement;
    staleCallback();
    clock.advance(3_000);
    expect(first.playDrum).toHaveBeenCalledTimes(2);
    expect(replacement.playDrum).not.toHaveBeenCalled();
    drums.update(snapshotAt(0));
    expect(replacement.playDrum).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels permanently, even if a stale callback or later snapshot arrives", () => {
    const { clock, drums, hits } = harness();
    drums.update(snapshotAt(0));
    const staleCallback = clock.queuedCallback();
    drums.dispose();
    drums.dispose();
    staleCallback();
    drums.update(snapshotAt(0));
    clock.advance(10_000);
    expect(hits).toHaveLength(2);
    expect(clock.pending.size).toBe(0);
  });
});
