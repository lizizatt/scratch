import { afterEach, describe, expect, it } from "vitest";
import { SilentAudioOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import { parseMidi } from "midi-file";
import { executeLoopCommand } from "./loop-commands.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { recordingToMidi, renderNeonWav } from "./mp3-exporter.js";
import { applyVelocityCurve, PerformanceRouter } from "./performance-router.js";
import type { MonotonicClock } from "./transport-clock.js";
import { TransportPlayback } from "./transport-playback.js";
import { pairRecording, rotateRecording } from "./circular-recording.js";
import type { RecordedMidiEvent } from "./loop-playback.js";

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
    for (let count = 0; count < 20_000; count++) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) { this.time = end; return; }
      this.time = Math.max(this.time, next[1].at);
      this.timers.delete(next[0]);
      next[1].callback();
    }
    throw new Error("Timer spin");
  }
}

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

async function host(arp = false, countIn = false) {
  const clock = new Clock();
  const engine = new SimulatedHostEngine();
  await engine.execute({ type: "configure", settings: { bpm: 120, loopMeasures: 1, countInEnabled: countIn, velocityCurve: "linear" } });
  await engine.execute({ type: "configure-arpeggiator", settings: { enabled: arp, rate: "1/8", gate: 0.5 } });
  const output: AudioOutput = new SilentAudioOutput();
  const replay: Array<{ at: number; event: MidiEvent }> = [];
  const live: Array<{ at: number; event: MidiEvent }> = [];
  const drums: Array<{ at: number; note: number }> = [];
  output.dispatchMidi = (event) => { replay.push({ at: clock.now(), event: structuredClone(event) }); };
  output.playDrum = (note) => { drums.push({ at: clock.now(), note }); };
  const loops = new MidiLoopScheduler(output, {
    stagedWaveform: (id, waveform) => engine.setStagedWaveform(id, waveform),
    captureError: (message) => engine.setCaptureError(message),
  });
  const router = new PerformanceRouter();
  const playback: TransportPlayback = new TransportPlayback(engine, output, (event, boundary) => {
    playback.advance();
    engine.markCaptureActivity();
    loops.record(event, engine.snapshot(), boundary);
    live.push({ at: clock.now(), event: structuredClone(event) });
  }, clock, loops);
  cleanups.push(() => { playback.dispose(); void engine.dispose(); });
  const input = (event: MidiEvent) => {
    playback.advance();
    const { velocityCurve, minimumVelocity } = engine.snapshot().settings;
    const curved = applyVelocityCurve(event, velocityCurve, minimumVelocity);
    engine.dispatchMidi(curved);
    for (const routed of router.route(curved)) playback.handle(routed);
  };
  const command = async (command: EngineCommand) => {
    if (["play", "stop", "configure", "configure-arpeggiator"].includes(command.type)) playback.advance();
    expect((await executeLoopCommand(command, engine, loops, playback)).accepted).toBe(true);
  };
  const poll = () => { playback.advance(); clock.setTimeout(poll, 50); };
  clock.setTimeout(poll, 50);
  return { engine, clock, loops, live, replay, drums, input, command };
}

async function releasedBeforePedal() {
  const h = await host();
  await h.command({ type: "play" });
  h.clock.until(200);
  h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
  h.clock.until(400);
  h.input({ type: "note-off", channel: 0, note: 60 });
  h.clock.until(600);
  h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
  h.clock.until(1_000);
  h.input({ type: "control-change", channel: 0, controller: 64, value: 0 });
  h.clock.until(2_010);
  await h.command({ type: "stop" });
  await h.command({ type: "set-loop-start", position: 0.4 });
  const snapshot = h.engine.snapshot();
  const take = snapshot.capture.staged!;
  const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
  return { ...h, snapshot, take, recording };
}

describe("independent loop-editing review reproductions", () => {
  it.each([false, true].flatMap((overdub) => [false, true].map((zeroRelease) => ({ overdub, zeroRelease }))))
    ("owns repeated/overlapping releases including carried gates: overdub=$overdub zero=$zeroRelease", async ({ overdub, zeroRelease }) => {
      const h = await host();
      await h.command({ type: "set-overdub", enabled: overdub });
      await h.command({ type: "play" });
      const on = (at: number, velocity: number) => {
        h.clock.until(at);
        h.input({ type: "note-on", channel: 0, note: 60, velocity });
      };
      const off = (at: number) => {
        h.clock.until(at);
        h.input(zeroRelease ? { type: "note-on", channel: 0, note: 60, velocity: 0 } : { type: "note-off", channel: 0, note: 60 });
      };
      on(1_800, 90); on(1_900, 110);
      off(2_100); off(2_300);
      on(2_400, 80); off(2_450); on(2_450, 100); off(2_500);
      h.clock.until(4_010);
      await h.command({ type: "stop" });
      const raw = h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording;
      expect(pairRecording(raw).notes.map(({ on, off }) => [
        Math.round(on.position * 2_000), Math.round(off.position * 2_000),
        "velocity" in on.event ? on.event.velocity : null,
      ]).sort((a, b) => a[0]! - b[0]!)).toEqual(overdub
        ? [[400, 450, 80], [450, 500, 100], [1_800, 2_100, 90], [1_900, 2_300, 110]]
        : [[0, 100, 90], [0, 300, 110], [400, 450, 80], [450, 500, 100]]);
    });

  it.each([false, true])("closes every still-held same-pitch owner at Stop in overdub (%s)", async (zeroRelease) => {
    const h = await host();
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    for (const at of [200, 300, 350]) {
      h.clock.until(at);
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    }
    h.clock.until(400);
    h.input(zeroRelease ? { type: "note-on", channel: 0, note: 60, velocity: 0 } : { type: "note-off", channel: 0, note: 60 });
    h.clock.until(600);
    await h.command({ type: "stop" });
    const pairs = pairRecording(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording).notes;
    expect(pairs.map(({ off }) => Math.round(off.position * 2_000))).toEqual([400, 600, 600]);
  });

  it("keeps FIFO continuation ownership for two same-pitch holds spanning whole cycles", async () => {
    const h = await host();
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    h.clock.until(200);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 90 });
    h.clock.until(300);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 110 });
    h.clock.until(4_500);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(4_700);
    h.input({ type: "note-off", channel: 0, note: 60 });
    await h.command({ type: "stop" });
    const pairs = pairRecording(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording).notes;
    expect(pairs).toHaveLength(2);
    expect(pairs.map(({ on, off }) => [Math.round(on.position * 2_000), Math.round(off.position * 2_000)])).toEqual([[200, 2_200], [300, 2_300]]);
  });

  it("reserves closures for every accepted overlapping owner at capacity", async () => {
    const h = await host();
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    h.clock.until(200);
    for (let index = 0; index < 9_000; index++) h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    expect(h.engine.snapshot().capture.error).toMatch(/capacity.*rejected/i);
    h.clock.until(400);
    for (let index = 0; index < 9_000; index++) h.input({ type: "note-on", channel: 0, note: 60, velocity: 0 });
    h.clock.until(600);
    await h.command({ type: "stop" });
    const staged = h.loops.captureSessionTakes(h.engine.snapshot()).staged!;
    const pairs = pairRecording(staged.rawRecording).notes;
    expect(pairs.length).toBeGreaterThan(1_000);
    expect(staged.rawRecording).toHaveLength(pairs.length * 2);
    expect(staged.rawRecording.length).toBeLessThanOrEqual(32_768);
    expect(staged.rawRecording.length + staged.recording.length).toBeLessThanOrEqual(100_000);
    expect(pairs.every(({ off }) => Math.abs(off.position - 0.2) < 1e-9)).toBe(true);
  }, 30_000);

  it.each([
    { name: "down before release", before: [127], after: [], held: true },
    { name: "down after release", before: [], after: [127], held: false },
    { name: "lift before release then repress", before: [0], after: [127], held: false },
    { name: "lift after release then repress", before: [127], after: [0, 127], held: false },
    { name: "repress before release", before: [0, 127], after: [], held: true },
  ].flatMap((entry) => [0.4, 0.2].map((origin) => ({ ...entry, origin }))))
    ("reconstructs sustain using event order: $name, marker=$origin", ({ before, after, held, origin }) => {
      const pedal = (value: number): RecordedMidiEvent => ({ position: 0.2, event: { type: "control-change", channel: 0, controller: 64, value } });
      const recording: RecordedMidiEvent[] = [
        { position: 0.05, event: { type: "control-change", channel: 0, controller: 64, value: 127 } },
        { position: 0.1, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
        ...before.map(pedal),
        { position: 0.2, event: { type: "note-off", channel: 0, note: 60 } },
        ...after.map(pedal),
        { position: 0.5, event: { type: "control-change", channel: 0, controller: 64, value: 0 } },
      ];
      // The late-down case starts with the pedal up.
      if (before.length === 0) recording.shift();
      const opening = rotateRecording(recording, origin).filter(({ position, event }) => position === 0 && event.type === "note-on");
      expect(opening).toHaveLength(held ? 1 : 0);
    });

  it.each([0, 0.1, 0.125].flatMap((origin) => [0, 30].map((late) => ({ origin, late }))))
    ("retains only actual count-in grid attacks: origin=$origin late=$late", async ({ origin, late }) => {
      const h = await host(true, true);
      await h.command({ type: "set-loop-start", position: origin });
      await h.command({ type: "configure-drums", settings: { enabled: true, pattern: "backbeat", volume: 1 } });
      await h.command({ type: "play" });
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      h.clock.until(1_950);
      h.clock.time = 2_000 + late;
      h.clock.until(2_000 + late);
      expect(h.live.filter(({ event }) => event.type === "note-on")).toHaveLength(origin === 0.1 ? 0 : 1);
      h.clock.until(3_999);
      const attacks = h.live.filter(({ event }) => event.type === "note-on").map(({ at }) => at);
      expect(attacks[0]).toBe(origin === 0.1 ? 2_050 : 2_000 + late);
      expect(h.drums.filter(({ note }) => note === 42).map(({ at }) => at)).toEqual(attacks);
    });

  it.each(( ["1/8", "1/8T", "1/16T"] as const).flatMap((rate) => [0, 0.35].map((swing) => ({ rate, swing }))))
    ("uses source beats for $rate swing=$swing, capture, and quantization without seeking marker edits", async ({ rate, swing }) => {
      const h = await host(true, true);
      const origin = 0.1;
      const rateBeat = rate === "1/8" ? 0.5 : rate === "1/8T" ? 1 / 3 : 1 / 6;
      await h.command({ type: "configure-arpeggiator", settings: { rate, swing, gate: 0.5 } });
      await h.command({ type: "set-loop-start", position: origin });
      await h.command({ type: "play" });
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      h.clock.until(2_750);
      const transport = h.engine.snapshot().transport;
      const before = structuredClone(h.live);
      await h.command({ type: "set-loop-start", position: 0.6 });
      expect(h.engine.snapshot().transport).toEqual(transport);
      expect(h.live).toEqual(before);
      h.clock.until(3_750);
      h.input({ type: "note-off", channel: 0, note: 60 });
      h.clock.until(4_010);
      await h.command({ type: "stop" });
      const expected: number[] = [];
      for (let step = 0; step < 40; step++) {
        const at = 2_000 + (rateBeat * (step + (step % 2 ? swing : 0)) - origin * 4) * 500;
        if (at >= 2_000 && at <= 3_750) expected.push(at);
      }
      const attacks = h.live.filter(({ at, event }) => at < 4_010 && event.type === "note-on");
      expect(attacks).toHaveLength(expected.length);
      attacks.forEach(({ at }, index) => expect(Math.abs(at - expected[index]!)).toBeLessThanOrEqual(1.01));
      const staged = h.loops.captureSessionTakes(h.engine.snapshot()).staged!;
      const sourceAttacks = staged.rawRecording.filter(({ event, continuation }) => event.type === "note-on" && !continuation).map(({ position }) => Math.round(position * 2_000)).sort((a, b) => a - b);
      expect(sourceAttacks).toEqual(attacks.map(({ at }) => Math.round((at - 2_000 + origin * 2_000) % 2_000)).sort((a, b) => a - b));
      await h.command({ type: "set-quantization", mode: "1/8" });
      expect(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.recording.filter(({ event }) => event.type === "note-on").every(({ position }) => Math.abs(position * 16 - Math.round(position * 16)) < 1e-9)).toBe(true);
      await h.command({ type: "set-quantization", mode: "off" });
      expect(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.recording).toEqual(staged.rawRecording);
    });

  it.each([false, true])("retains both FIFO releases for overlapping same-pitch input with overdub %s", async (overdub) => {
    const h = await host();
    await h.command({ type: "set-overdub", enabled: overdub });
    await h.command({ type: "play" });
    h.clock.until(200);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 90 });
    h.clock.until(300);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 110 });
    h.clock.until(400);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(600);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(2_010);
    await h.command({ type: "stop" });
    const snapshot = h.engine.snapshot();
    const staged = h.loops.captureSessionTakes(snapshot).staged!;
    const midi = parseMidi(recordingToMidi(staged.recording, staged.take, snapshot));
    let tick = 0;
    const releases = midi.tracks[1]!.flatMap((event) => {
      tick += event.deltaTime;
      return event.type === "noteOff" ? [tick] : [];
    });
    expect(releases).toEqual([384, 576]);
  });

  it("does not resurrect a previously released key when the pedal was pressed later: replay", async () => {
    const h = await releasedBeforePedal();
    h.replay.length = 0;
    await h.command({ type: "play" });
    h.clock.until(2_110);
    expect(h.replay.filter(({ event }) => event.type === "note-on")).toEqual([]);
  });

  it("does not resurrect a previously released key when the pedal was pressed later: MIDI", async () => {
    const h = await releasedBeforePedal();
    const midi = parseMidi(recordingToMidi(h.recording, h.take, h.snapshot));
    let tick = 0;
    const attacks = midi.tracks[1]!.flatMap((event) => {
      tick += event.deltaTime;
      return event.type === "noteOn" ? [tick] : [];
    });
    expect(attacks).toEqual([1_344]);
  });

  it("does not resurrect a previously released key when the pedal was pressed later: PCM", async () => {
    const h = await releasedBeforePedal();
    h.snapshot.synth.parameterValues = { attack: 0.001, release: 0.01, cutoff: 6_300, resonance: 0.2 };
    const wav = await renderNeonWav(h.recording, h.take, h.snapshot);
    let peak = 0;
    for (let frame = 960; frame < 4_800; frame++) peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + frame * 4)));
    expect(peak).toBeLessThan(4);
  });

  it.each([0, 0.1])("keeps eighth-note arp and hats on the same source grid after count-in at origin %s", async (origin) => {
    const h = await host(true, true);
    await h.command({ type: "set-loop-start", position: origin });
    await h.command({ type: "configure-drums", settings: { enabled: true, pattern: "backbeat", volume: 1 } });
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(3_999);
    const arp = h.live.filter(({ event }) => event.type === "note-on").map(({ at }) => at);
    const hats = h.drums.filter(({ note }) => note === 42).map(({ at }) => at);
    expect(arp).toHaveLength(8);
    expect(hats).toEqual(arp);
  });
});
