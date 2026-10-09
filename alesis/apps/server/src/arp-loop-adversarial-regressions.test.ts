import { afterEach, describe, expect, it, vi } from "vitest";
import { NeonPressureSynth, SilentAudioOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import type { EngineCommand, LoopSession } from "@alesis/protocol";
import { executeLoopCommand } from "./loop-commands.js";
import { MidiLoopScheduler, quantizeRecording } from "./loop-playback.js";
import { exportLoopSession, importLoopSession, type LoopSessionHost } from "./loop-session.js";
import { PerformanceRouter } from "./performance-router.js";
import type { MonotonicClock } from "./transport-clock.js";
import { TransportPlayback } from "./transport-playback.js";

type Timer = ReturnType<typeof setTimeout>;
interface Delivery { at: number; event: MidiEvent }

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
    for (;;) {
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

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });

async function host(arpEnabled = false, bpm = 120, countInEnabled = false, gate = 0.5) {
  const clock = new Clock();
  const engine = new SimulatedHostEngine();
  await engine.execute({ type: "configure", settings: { bpm, loopMeasures: 1, countInEnabled, velocityCurve: "linear" } });
  await engine.execute({ type: "configure-arpeggiator", settings: { enabled: arpEnabled, rate: "1/8", gate } });
  const live: Delivery[] = [];
  const replay: Delivery[] = [];
  const output: AudioOutput = new SilentAudioOutput();
  output.dispatchMidi = (event) => { replay.push({ at: clock.now(), event: structuredClone(event) }); };
  const loops = new MidiLoopScheduler(output);
  const router = new PerformanceRouter();
  const playback: TransportPlayback = new TransportPlayback(engine, output, (event, endsAtCycleBoundary) => {
    // Same delivery/capture ordering as main's dispatchArpeggio and dispatchPerformance.
    playback.advance();
    engine.markCaptureActivity();
    loops.record(event, engine.snapshot(), endsAtCycleBoundary);
    live.push({ at: clock.now(), event: structuredClone(event) });
  }, clock, loops);
  cleanups.push(() => { playback.dispose(); void engine.dispose(); });
  const input = (event: MidiEvent) => {
    playback.advance();
    engine.dispatchMidi(event);
    for (const routed of router.route(event)) playback.handle(routed);
  };
  const command = async (command: EngineCommand) => {
    if (["play", "stop", "configure", "configure-arpeggiator"].includes(command.type)) playback.advance();
    expect((await executeLoopCommand(command, engine, loops, playback)).accepted).toBe(true);
  };
  const poll = () => { playback.advance(); clock.setTimeout(poll, 50); };
  clock.setTimeout(poll, 50);
  const sessionHost: LoopSessionHost = {
    engine, loops, percussionSoundFontId: null, inspectPresets: () => [],
    prepareAudio: vi.fn(async () => ({ commit() {}, async dispose() {} })),
  };
  return { clock, engine, loops, playback, live, replay, input, command, sessionHost };
}

function render(deliveries: Delivery[], endMs: number): Float32Array {
  // Real production DSP, offline only: no ALSA or speaker access.
  const synth = new NeonPressureSynth(48_000, { attack: 0.001, release: 0.02 });
  const result = new Float32Array(Math.round(endMs * 48) * 2);
  let frame = 0;
  for (const { at, event } of deliveries) {
    const next = Math.round(at * 48);
    if (next > result.length / 2) break;
    result.set(synth.render(next - frame), frame * 2);
    frame = next;
    synth.dispatchMidi(event);
  }
  result.set(synth.render(result.length / 2 - frame), frame * 2);
  return result;
}

function rms(samples: Float32Array, startMs: number, endMs: number): number {
  const slice = samples.subarray(Math.round(startMs * 48) * 2, Math.round(endMs * 48) * 2);
  return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length);
}

describe("confirmed adversarial loop regressions", () => {
  it.each([0, 2])("seeds only the contributing melodic channel, not stale channel state (channel %s)", async (channel) => {
    const h = await host();
    h.input({ type: "pitch-bend", channel: 0, value: 0.5 });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 100 });
    h.input({ type: "note-off", channel: 2, note: 60 });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.input({ type: "pitch-bend", channel: 0, value: -0.5 });
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel, note: 64, velocity: 100 });
    h.clock.until(100);
    h.input({ type: "note-off", channel, note: 64 });
    h.clock.until(2_001);
    const attack = h.replay.findIndex(({ event }) => event.type === "note-on");
    const bends = h.replay.slice(0, attack).filter(({ event }) => event.type === "pitch-bend");
    expect(bends.at(-1)?.event).toEqual({ type: "pitch-bend", channel: 1, value: -0.5 });
    const take = h.engine.snapshot().capture.staged!;
    expect(h.loops.exportRecordings([take.id]).get(take.id)!
      .filter(({ event }) => event.type === "pitch-bend").every(({ event }) => event.channel === channel)).toBe(true);
  });

  it.each([0, 2].flatMap((channel) => [false, true].map((reverse) => ({ channel, reverse }))))(
    "uses the contributing channel's opposite held state regardless of insertion order ($channel, reverse=$reverse)", async ({ channel, reverse }) => {
      const h = await host();
      const channels = reverse ? [2, 0] : [0, 2];
      for (const source of channels) {
        // Delivered channels can retain different state, regardless of input routing history.
        h.playback.handle({ type: "pitch-bend", channel: source, value: source === 0 ? -0.5 : 0.5 });
        h.playback.handle({ type: "control-change", channel: source, controller: 64, value: source === 0 ? 80 : 127 });
      }
      await h.command({ type: "play" });
      h.playback.handle({ type: "note-on", channel, note: 60, velocity: 100 });
      h.clock.until(4_001);
      // Check both the original capture and its carried held-note successor.
      for (const start of [2_000, 4_000]) {
        const opening = h.replay.filter(({ at }) => at >= start);
        const attack = opening.findIndex(({ event }) => event.type === "note-on");
        expect(attack).toBeGreaterThanOrEqual(0);
        const outputChannel = opening[attack]!.event.channel;
        const prefix = opening.slice(0, attack);
        expect(prefix.filter(({ event }) => event.type === "pitch-bend").at(-1)?.event)
          .toEqual({ type: "pitch-bend", channel: outputChannel, value: channel === 0 ? -0.5 : 0.5 });
        expect(prefix.filter(({ event }) => event.type === "control-change").at(-1)?.event)
          .toEqual({ type: "control-change", channel: outputChannel, controller: 64, value: channel === 0 ? 80 : 127 });
      }
    });

  it("captures a newly contributing channel's routed controls mid-cycle, not its stale pre-Play state", async () => {
    const h = await host();
    h.input({ type: "pitch-bend", channel: 0, value: 0.5 });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 100 });
    h.input({ type: "note-off", channel: 2, note: 60 });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.input({ type: "pitch-bend", channel: 0, value: -0.5 });
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 0, note: 64, velocity: 100 });
    h.clock.until(100);
    h.input({ type: "note-off", channel: 0, note: 64 });
    h.clock.until(500);
    h.input({ type: "pitch-bend", channel: 0, value: 0.25 });
    h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
    h.input({ type: "note-on", channel: 2, note: 67, velocity: 100 });
    h.clock.until(600);
    h.input({ type: "note-off", channel: 2, note: 67 });
    h.clock.until(2_601);
    const attacks = h.replay.filter(({ event }) => event.type === "note-on");
    expect(attacks).toHaveLength(2);
    for (const [index, value] of [-0.5, 0.25].entries()) {
      const prefix = h.replay.slice(0, h.replay.indexOf(attacks[index]!));
      expect(prefix.filter(({ event }) => event.type === "pitch-bend").at(-1)?.event)
        .toEqual({ type: "pitch-bend", channel: 1, value });
    }
    const recording = h.loops.exportRecordings([h.engine.snapshot().capture.staged!.id]).values().next().value!;
    const caughtUp = recording.filter(({ event }) => event.channel === 2 && event.type !== "note-off");
    expect(caughtUp.map(({ event }) => event)).toEqual([
      { type: "control-change", channel: 2, controller: 64, value: 127 },
      { type: "pitch-bend", channel: 2, value: 0.25 },
      { type: "note-on", channel: 2, note: 67, velocity: 100 },
    ]);
    for (const { position } of caughtUp) expect(position).toBeCloseTo(0.25, 10);
  });

  it("keeps the surviving same-bin attack's gate instead of the discarded attack's gate", async () => {
    const h = await host();
    await h.command({ type: "set-quantization", mode: "1/4" });
    await h.command({ type: "play" });
    h.clock.until(260);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 70 });
    h.clock.until(280);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(400);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(1_300);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(3_600);
    const attacks = h.replay.filter(({ event }) => event.type === "note-on");
    expect(attacks).toHaveLength(1);
    expect(attacks[0]!.event).toMatchObject({ velocity: 80 });
    expect(Math.abs(attacks[0]!.at - 2_500)).toBeLessThanOrEqual(1);
    const firstRelease = h.replay.find(({ at, event }) => at > attacks[0]!.at && event.type === "note-off")!;
    expect(Math.abs(firstRelease.at - 3_500)).toBeLessThanOrEqual(1);
  });

  it("loads a valid v1 staged take produced by the previous quantizer", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.clock.until(1_500);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(1_875);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(2_001);
    await h.command({ type: "stop" });
    const session = JSON.parse(exportLoopSession(h.sessionHost).sessionJson!) as LoopSession;
    session.quantization = "1/4";
    // Frozen output of the pre-change quantizer for these valid raw events.
    session.staged!.recording = [
      { position: 0, event: { type: "note-off", channel: 0, note: 60 } },
      { position: 0.75, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
    ];
    h.playback.suspend();
    try {
      await expect(importLoopSession(JSON.stringify(session), h.sessionHost)).resolves.toMatchObject({ accepted: true });
    } finally {
      h.playback.resume();
    }
  });

  it("preserves a held pedal in the second captured arp cycle, including rendered gate tails", async () => {
    const h = await host(true);
    await h.command({ type: "set-synth-parameter", parameterId: "attack", value: 0.001 });
    await h.command({ type: "set-synth-parameter", parameterId: "release", value: 0.02 });
    await h.command({ type: "play" });
    h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(4_240);
    const heard = render(h.live, 4_240);
    const replayed = render(h.replay, 4_240);
    const heardTail = rms(heard, 2_200, 2_230);
    const replayTail = rms(replayed, 4_200, 4_230);
    expect(heardTail).toBeGreaterThan(0.01);
    // Velocity attenuation is allowed, disappearance of a sustained gate is not.
    expect(replayTail).toBeGreaterThan(heardTail * 0.1);
  });

  it("initializes the second captured arp cycle with the still-held pitch bend", async () => {
    const h = await host(true);
    await h.command({ type: "play" });
    h.input({ type: "pitch-bend", channel: 0, value: 0.75 });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(4_020);
    const take = h.engine.snapshot().capture.staged!;
    expect(take.cycle).toBe(1);
    const captured = h.loops.exportRecordings([take.id]).get(take.id)!;
    const firstAttack = captured.findIndex(({ event }) => event.type === "note-on");
    expect(captured.slice(0, firstAttack).map(({ event }) => event)).toContainEqual({ type: "pitch-bend", channel: 0, value: 0.75 });
  });

  it.each([false, true])("captures pre-Play routed controllers before attacks (count-in=%s), with audible sustain", async (countIn) => {
    const h = await host(true, 120, countIn);
    h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
    h.input({ type: "pitch-bend", channel: 0, value: 0.75 });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 100 });
    await h.command({ type: "play" });
    const opening = countIn ? 2_000 : 0;
    h.clock.until(opening + 2_240);
    const take = h.engine.snapshot().capture.staged!;
    const captured = h.loops.exportRecordings([take.id]).get(take.id)!;
    const prefix = captured.slice(0, captured.findIndex(({ event }) => event.type === "note-on"));
    expect(prefix).toContainEqual({ position: 0, event: { type: "control-change", channel: 2, controller: 64, value: 127 } });
    expect(prefix).toContainEqual({ position: 0, event: { type: "pitch-bend", channel: 2, value: 0.75 } });
    const replayPrefix = h.replay.slice(0, h.replay.findIndex(({ event }) => event.type === "note-on"));
    expect(replayPrefix.map(({ event }) => event)).toContainEqual({ type: "pitch-bend", channel: 1, value: 0.75 });
    expect(replayPrefix.map(({ event }) => event)).toContainEqual({ type: "control-change", channel: 1, controller: 64, value: 127 });
    const heard = rms(render(h.live, opening + 2_240), opening + 200, opening + 230);
    expect(heard).toBeGreaterThan(0.01);
    expect(rms(render(h.replay, opening + 2_240), opening + 2_200, opening + 2_230)).toBeGreaterThan(heard * 0.1);
  });

  it.each(["stop", "clear"] as const)("retains live controller holds through %s and resumes capture without new controller input", async (action) => {
    const h = await host(true);
    await h.command({ type: "play" });
    h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
    h.input({ type: "pitch-bend", channel: 0, value: -0.5 });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 100 });
    h.clock.until(100);
    if (action === "stop") {
      await h.command({ type: "stop" });
      h.clock.until(200);
      await h.command({ type: "play" });
    } else {
      await h.command({ type: "configure", settings: { bpm: 120 }, clearAudio: true });
    }
    h.clock.until(2_201);
    const take = h.engine.snapshot().capture.staged!;
    const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
    expect(recording.slice(0, recording.findIndex(({ event }) => event.type === "note-on")).map(({ event }) => event))
      .toEqual(expect.arrayContaining([
        { type: "control-change", channel: 2, controller: 64, value: 127 },
        { type: "pitch-bend", channel: 2, value: -0.5 },
      ]));
  });

  it.each(["release", "panic", "restore"] as const)("does not seed stale controllers after %s", async (action) => {
    const h = await host(true);
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 100 });
    h.clock.until(100);
    h.input({ type: "note-off", channel: 2, note: 60 });
    h.clock.until(2_001);
    await h.command({ type: "stop" });
    const session = exportLoopSession(h.sessionHost).sessionJson!;
    h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
    h.input({ type: "pitch-bend", channel: 0, value: 0.75 });
    if (action === "release") {
      h.input({ type: "control-change", channel: 0, controller: 64, value: 0 });
      h.input({ type: "pitch-bend", channel: 0, value: 0 });
    } else if (action === "panic") {
      h.playback.panic();
      h.loops.resetRecordingInput();
    } else {
      h.playback.suspend();
      await importLoopSession(session, h.sessionHost);
      h.playback.resume();
    }
    await h.command({ type: "play" });
    // Bypass the router here: a production panic/import clears that router too.
    h.playback.handle({ type: "note-on", channel: 2, note: 64, velocity: 100 });
    h.clock.until(4_002);
    const take = h.engine.snapshot().capture.staged!;
    const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
    expect(recording.some(({ event }) => event.type === "pitch-bend" || event.type === "control-change")).toBe(false);
  });

  it("retains controller state when session audio preparation fails", async () => {
    const h = await host(true);
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 100 });
    h.clock.until(100);
    h.input({ type: "note-off", channel: 2, note: 60 });
    h.clock.until(2_001);
    await h.command({ type: "stop" });
    const session = exportLoopSession(h.sessionHost).sessionJson!;
    h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
    h.input({ type: "pitch-bend", channel: 0, value: 0.75 });
    vi.mocked(h.sessionHost.prepareAudio).mockRejectedValueOnce(new Error("candidate renderer failed"));
    h.playback.suspend();
    await expect(importLoopSession(session, h.sessionHost)).rejects.toThrow("candidate renderer failed");
    h.playback.resume();
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 2, note: 64, velocity: 100 });
    h.clock.until(4_002);
    const take = h.engine.snapshot().capture.staged!;
    const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
    expect(recording.slice(0, recording.findIndex(({ event }) => event.type === "note-on")).map(({ event }) => event))
      .toEqual([
        { type: "control-change", channel: 2, controller: 64, value: 127 },
        { type: "pitch-bend", channel: 2, value: 0.75 },
      ]);
  });

  it("carries distinct delivered channel states before synthetic held attacks, including percussion mapping", async () => {
    const h = await host();
    await h.command({ type: "play" });
    for (const [channel, value] of [[2, 0.75], [9, -0.5]] as const) {
      // Already routed output: separate channels need not share controller values.
      h.playback.handle({ type: "pitch-bend", channel, value });
      h.playback.handle({ type: "control-change", channel, controller: 64, value: 127 });
      h.playback.handle({ type: "note-on", channel, note: 60, velocity: 100 });
    }
    h.clock.until(4_001);
    const take = h.engine.snapshot().capture.staged!;
    const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
    const firstAttack = recording.findIndex(({ event }) => event.type === "note-on");
    expect(firstAttack).toBe(4);
    expect(recording.slice(0, firstAttack).map(({ event }) => event)).toEqual([
      { type: "pitch-bend", channel: 2, value: 0.75 },
      { type: "control-change", channel: 2, controller: 64, value: 127 },
      { type: "pitch-bend", channel: 9, value: -0.5 },
      { type: "control-change", channel: 9, controller: 64, value: 127 },
    ]);
    expect(h.replay.map(({ event }) => event)).toEqual(expect.arrayContaining([
      { type: "pitch-bend", channel: 1, value: 0.75 },
      { type: "pitch-bend", channel: 9, value: -0.5 },
    ]));
  });

  it("retains a genuine sub-millisecond hold past rollover rather than treating it as a scheduled boundary release", async () => {
    const h = await host();
    await h.command({ type: "play" });
    h.clock.until(1_900);
    h.input({ type: "note-on", channel: 2, note: 60, velocity: 100 });
    h.clock.until(2_000.5);
    h.input({ type: "note-off", channel: 2, note: 60 });
    h.clock.until(4_001);
    const take = h.engine.snapshot().capture.staged!;
    const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
    expect(recording).toHaveLength(2);
    expect(recording[0]).toEqual({ position: 0, event: { type: "note-on", channel: 2, note: 60, velocity: 100 } });
    expect(recording[1]!.event).toEqual({ type: "note-off", channel: 2, note: 60 });
    expect(recording[1]!.position * 2_000).toBeCloseTo(0.5, 8);
  });

  it.each([118, 137].flatMap((bpm) => [0, 2, 10, 30].map((late) => ({ bpm, late }))))(
    "does not carry a full-gate arp attack across a noninteger boundary ($bpm BPM, $late ms late)", async ({ bpm, late }) => {
      const h = await host(true, bpm, false, 1);
      await h.command({ type: "play" });
      h.input({ type: "note-on", channel: 2, note: 60, velocity: 100 });
      h.input({ type: "note-on", channel: 2, note: 64, velocity: 100 });
      const duration = 240_000 / bpm;
      h.clock.until(duration - 5);
      h.clock.time = Math.ceil(duration) + late;
      h.clock.until(h.clock.time);
      h.clock.until(Math.ceil(2 * duration) + 1);
      const take = h.engine.snapshot().capture.staged!;
      expect(take.cycle).toBe(1);
      const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
      expect(recording.filter(({ position, event }) => position < 0.02 && event.type === "note-on" && event.note === 64)).toEqual([]);
    });

  it.each([false, true])("retains the winning pair across the terminal seam (velocity-zero release=%s)", (zeroRelease) => {
    const release: MidiEvent = zeroRelease ? { type: "note-on", channel: 2, note: 60, velocity: 0 } : { type: "note-off", channel: 2, note: 60 };
    expect(quantizeRecording([
      { position: 0.01, event: { type: "note-on", channel: 2, note: 60, velocity: 70 } },
      { position: 0.6, event: release },
      { position: 0.95, event: { type: "note-on", channel: 2, note: 60, velocity: 100 } },
      { position: 1, event: release },
    ], "1/4", 4)).toEqual([
      { position: 0, event: { type: "note-on", channel: 2, note: 60, velocity: 100 } },
      { position: 0.25, event: release },
    ]);
  });
});
