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
import { recordingToMidi, renderNeonWav } from "./mp3-exporter.js";
import { parseMidi } from "midi-file";
import { makeDrumRecording } from "./loop-sample-exporter.js";
import { exportLoopSession, importLoopSession, type LoopSessionHost } from "./loop-session.js";
import { parseLoopSession } from "@alesis/protocol";

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
  const drums: Array<{ at: number; note: number; velocity: number }> = [];
  const output: AudioOutput = new SilentAudioOutput();
  output.playDrum = (note, velocity) => { drums.push({ at: clock.now(), note, velocity }); };
  output.dispatchMidi = (event) => { replay.push({ at: clock.now(), event: structuredClone(event) }); };
  const loops = new MidiLoopScheduler(output, {
    stagedWaveform: (id, waveform) => engine.setStagedWaveform(id, waveform),
    captureError: (message) => engine.setCaptureError(message),
  });
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
    const { velocityCurve, minimumVelocity } = engine.snapshot().settings;
    const curved = applyVelocityCurve(event, velocityCurve, minimumVelocity);
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
  return { engine, clock, loops, live, replay, drums, input, command };
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
  it("rotates a quantized wrapped gate as one attack rather than retriggering its continuation", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    h.clock.until(1_800);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(2_200);
    h.input({ type: "note-off", channel: 0, note: 60 });
    await h.command({ type: "stop" });
    await h.command({ type: "set-quantization", mode: "1/8" });
    await h.command({ type: "set-loop-start", position: 0.5 });
    const take = h.engine.snapshot().capture.staged!;
    const rendered = h.loops.captureRecordings(h.engine.snapshot(), [take.id]).get(take.id)!;
    const midi = parseMidi(recordingToMidi(rendered, take, h.engine.snapshot()));
    expect(midi.tracks[1]!.filter((event) => event.type === "noteOn")).toHaveLength(1);
    h.replay.length = 0;
    await h.command({ type: "play" });
    h.clock.until(4_199);
    expect(h.replay.filter(({ event }) => event.type === "note-on")).toHaveLength(1);
  });

  it("keeps exact-marker controller state ahead of replay and exported attacks", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "play" });
    h.clock.until(500);
    h.input({ type: "pitch-bend", channel: 0, value: 0.75 });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(700);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(2_010);
    await h.command({ type: "stop" });
    const take = h.engine.snapshot().capture.staged!;
    const raw = h.loops.exportRecordings([take.id]).get(take.id)!;
    await h.command({ type: "set-loop-start", position: raw.find(({ event }) => event.type === "pitch-bend")!.position });
    h.replay.length = 0;
    await h.command({ type: "play" });
    h.clock.until(2_012);
    const attack = h.replay.findIndex(({ event }) => event.type === "note-on");
    expect(h.replay.slice(0, attack).filter(({ event }) => event.type === "pitch-bend").at(-1)?.event).toMatchObject({ value: 0.75 });
    const midi = parseMidi(recordingToMidi(raw, take, h.engine.snapshot()));
    const events = midi.tracks[1]!;
    expect(events.slice(0, events.findIndex((event) => event.type === "noteOn")).filter((event) => event.type === "pitchBend").at(-1)).toMatchObject({ value: 6144 });
  });

  it.each([0, 0.25, 0.5, 0.75])("retains one held overdub through multiple passes at origin %s", async (origin) => {
    const h = await host({ enabled: false });
    await h.command({ type: "set-loop-start", position: origin });
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    h.clock.until(1_800);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(6_200);
    h.input({ type: "note-off", channel: 0, note: 60 });
    await h.command({ type: "stop" });
    const raw = h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording;
    expect(raw.every(({ position }) => position >= 0 && position <= 1)).toBe(true);
    expect(raw.filter(({ event }) => event.type === "note-on").length).toBeLessThanOrEqual(2);
    const saved = exportLoopSession({ engine: h.engine, loops: h.loops, percussionSoundFontId: null, inspectPresets: () => [], prepareAudio: async () => ({ commit() {}, async dispose() {} }) });
    expect(() => parseLoopSession(saved.sessionJson!)).not.toThrow();
    await h.command({ type: "play" });
    h.clock.until(8_210);
    expect(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording).toEqual(raw);
  });

  it.each([false, true])("Stop preserves the last held note only in overdub mode (%s)", async (overdub) => {
    const h = await host({ enabled: false });
    await h.command({ type: "set-overdub", enabled: overdub });
    await h.command({ type: "play" });
    h.clock.until(200);
    h.input({ type: "note-on", channel: 0, note: 67, velocity: 100 });
    h.clock.until(450);
    await h.command({ type: "stop" });
    const session = h.loops.captureSessionTakes(h.engine.snapshot());
    if (!overdub) expect(session.staged).toBeNull();
    else {
      expect(session.staged!.rawRecording.map(({ event }) => event.type)).toEqual(["note-on", "note-off"]);
      expect(session.staged!.rawRecording[1]!.position).toBeCloseTo(0.225);
    }
  });

  it("renders a carried gate and pedal-held release at the selected seam with offline PCM and MIDI agreement", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "play" });
    h.clock.until(200);
    h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
    h.clock.until(250);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(400);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(800);
    h.input({ type: "control-change", channel: 0, controller: 64, value: 0 });
    h.clock.until(2_010);
    await h.command({ type: "stop" });
    await h.command({ type: "set-loop-start", position: 0.25 });
    const snapshot = h.engine.snapshot();
    snapshot.synth.parameterValues = { attack: 0.001, release: 0.01, cutoff: 6_300, resonance: 0.2 };
    const take = snapshot.capture.staged!;
    const recording = h.loops.exportRecordings([take.id]).get(take.id)!;
    const wav = await renderNeonWav(recording, take, snapshot);
    const peak = (start: number, end: number) => {
      let value = 0;
      for (let frame = Math.round(start * 48_000); frame < end * 48_000; frame++) value = Math.max(value, Math.abs(wav.readInt16LE(44 + frame * 4)));
      return value;
    };
    expect(peak(0.02, 0.1)).toBeGreaterThan(100);
    expect(peak(0.6, 1.5)).toBeLessThan(4);
    expect(peak(1.78, 1.85)).toBeGreaterThan(100);
    const midi = parseMidi(recordingToMidi(recording, take, snapshot));
    let tick = 0;
    const gates = midi.tracks[1]!.flatMap((event) => { tick += event.deltaTime; return event.type === "noteOn" || event.type === "noteOff" ? [{ tick, type: event.type }] : []; });
    expect(gates.slice(0, 2)).toEqual([{ tick: 0, type: "noteOn" }, { tick: 1, type: "noteOff" }]);
  });

  it("does not treat a held gate's next-pass continuation as a new replacement attack", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    h.clock.until(1_980);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 90 });
    h.clock.until(2_100);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(4_010);
    const raw = h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording;
    expect(raw.filter(({ event, position }) => event.type === "note-on" && position > 0.9)).toHaveLength(1);
    expect(raw.find(({ event, position }) => event.type === "note-off" && position < 0.1)?.position).toBeCloseTo(0.05);
    h.clock.until(5_990);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 110 });
    h.clock.until(6_150);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(8_010);
    const replaced = h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording;
    expect(replaced.filter(({ event }) => event.type === "note-on").every(({ event }) => event.type === "note-on" && event.velocity === 110)).toBe(true);
    const releases = replaced.filter(({ event }) => event.type === "note-off");
    expect(releases).toHaveLength(2);
    expect(releases[0]!.position).toBeCloseTo(0.075, 9);
    expect(releases[1]!.position).toBe(1);
  });

  it("preserves mode-change prefixes, closes partial promotion, freezes it through undo and roundtrips the source origin", async () => {
    const h = await host({ enabled: false });
    const note = (at: number, pitch: number) => {
      h.clock.until(at);
      h.input({ type: "note-on", channel: 0, note: pitch, velocity: 100 });
      h.clock.until(at + 50);
      h.input({ type: "note-off", channel: 0, note: pitch });
    };
    await h.command({ type: "play" });
    note(100, 60);
    h.clock.until(2_010);
    const id = h.engine.snapshot().capture.staged!.id;
    note(2_100, 64);
    await h.command({ type: "set-overdub", enabled: true });
    note(2_400, 67);
    await h.command({ type: "set-overdub", enabled: false });
    const merged = h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording;
    expect(merged.filter(({ event }) => event.type === "note-on")).toHaveLength(3);
    await h.command({ type: "set-overdub", enabled: true });
    note(2_800, 72);
    await h.command({ type: "promote-staged" });
    expect(h.engine.snapshot().promoted[0]!.id).toBe(id);
    const frozen = h.loops.exportRecordings([id]).get(id)!;
    expect(frozen.filter(({ event }) => event.type === "note-on")).toHaveLength(4);
    note(3_100, 76);
    h.clock.until(4_010);
    expect(h.engine.snapshot().capture.staged!.id).not.toBe(id);
    expect(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording.filter(({ event }) => event.type === "note-on")).toHaveLength(1);
    await h.command({ type: "delete-take", takeId: id });
    await h.command({ type: "undo-delete" });
    expect(h.loops.exportRecordings([id]).get(id)).toEqual(frozen);
    await h.command({ type: "set-loop-start", position: 0.25 });
    await h.command({ type: "stop" });
    const sessionHost: LoopSessionHost = { engine: h.engine, loops: h.loops, percussionSoundFontId: null, inspectPresets: () => [], prepareAudio: async () => ({ commit() {}, async dispose() {} }) };
    const saved = parseLoopSession(exportLoopSession(sessionHost).sessionJson!);
    expect(saved).toMatchObject({ sourceOrigin: 0, loopStart: 0.25, overdub: true });
    await h.command({ type: "configure", settings: { bpm: 121 }, clearAudio: true });
    expect(h.engine.snapshot().capture).toMatchObject({ staged: null, loopStart: 0, error: null });
    expect(h.loops.storageStats().recordings).toBe(0);
    await importLoopSession(JSON.stringify(saved), sessionHost);
    const restored = parseLoopSession(exportLoopSession(sessionHost).sessionJson!);
    expect(restored.staged!.rawRecording).toEqual(saved.staged!.rawRecording);
    expect(restored.promoted[0]!.recording).toEqual(frozen);
    expect(h.engine.snapshot().capture).toMatchObject({ loopStart: 0.25, overdub: true });
  });

  it("records a rotated restart back into source coordinates and merges circular nearest pitches before quantizing", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    h.clock.until(1_970);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 50 });
    h.clock.until(1_990);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(2_010);
    await h.command({ type: "stop" });
    await h.command({ type: "set-loop-start", position: 0.75 });
    await h.command({ type: "play" });
    h.clock.until(2_540);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(2_600);
    h.input({ type: "note-off", channel: 0, note: 60 });
    await h.command({ type: "stop" });
    const raw = h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording;
    const attacks = raw.filter(({ event }) => event.type === "note-on");
    expect(attacks).toHaveLength(1);
    expect(attacks[0]!.position).toBeCloseTo(0.015, 9);
    expect(attacks[0]!.event).toMatchObject({ velocity: 100 });
    await h.command({ type: "set-quantization", mode: "1/8" });
    expect(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.recording[0]!.position).toBe(0);
    await h.command({ type: "set-quantization", mode: "off" });
    expect(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.recording).toEqual(raw);
  });

  it("keeps the live and staged waveform in source coordinates after a rotated restart", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "set-loop-start", position: 0.5 });
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(100);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(110);
    expect(h.engine.snapshot().capture.currentWaveform[0]).toBe(0);
    expect(h.engine.snapshot().capture.currentWaveform[48]).toBeGreaterThan(0);
    h.clock.until(2_010);
    expect(h.engine.snapshot().capture.staged!.waveform[0]).toBe(0);
    expect(h.engine.snapshot().capture.staged!.waveform[48]).toBeGreaterThan(0);
  });

  it("reports capture capacity rejection without erasing accepted overdubs or growing beyond session limits", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    for (let index = 0; index < 17_000; index++) {
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      h.input({ type: "note-off", channel: 0, note: 60 });
    }
    expect(h.engine.snapshot().capture.error).toMatch(/capacity.*rejected/i);
    await h.command({ type: "stop" });
    const session = h.loops.captureSessionTakes(h.engine.snapshot());
    expect(session.staged!.rawRecording.length).toBeGreaterThan(1_000);
    expect(session.staged!.rawRecording.length).toBeLessThanOrEqual(32_768);
    expect(session.staged!.recording.length + session.staged!.rawRecording.length).toBeLessThanOrEqual(100_000);
  }, 30_000);

  it.each([false, true])("starts generated drums at the selected source beat with MIDI export parity (count-in %s)", async (countIn) => {
    const h = await host({ enabled: false }, 120, countIn);
    await h.command({ type: "set-loop-start", position: 0.25 });
    await h.command({ type: "configure-drums", settings: { enabled: true, pattern: "backbeat", volume: 1 } });
    await h.command({ type: "play" });
    const start = countIn ? 2_000 : 0;
    h.clock.until(start + 1_999);
    const midi = parseMidi(recordingToMidi(makeDrumRecording(h.engine.snapshot()), { id: "drums", cycle: 0, level: 1, muted: false, waveform: [] }, h.engine.snapshot()));
    let tick = 0;
    const exported = midi.tracks[1]!.flatMap((event) => {
      tick += event.deltaTime;
      return event.type === "noteOn" ? [{ at: tick * 500 / 480, note: event.noteNumber, velocity: event.velocity }] : [];
    });
    expect(h.drums.map(({ at, ...hit }) => ({ at: at - start, ...hit }))).toEqual(exported);
  });

  it("initializes a controller change exactly on the marker before its attack, without restoring stale state over it", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "play" });
    h.clock.until(500);
    h.input({ type: "pitch-bend", channel: 0, value: 0.75 });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(700);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(2_010);
    await h.command({ type: "stop" });
    await h.command({ type: "set-loop-start", position: 0.25 });
    h.replay.length = 0;
    await h.command({ type: "play" });
    h.clock.until(2_012);
    const events = h.replay.map(({ event }) => event);
    const attack = events.findIndex((event) => event.type === "note-on");
    expect(events.slice(0, attack).filter((event) => event.type === "pitch-bend").at(-1)).toMatchObject({ value: 0.75 });
    expect(events.filter((event) => event.type === "pitch-bend").at(-1)).toMatchObject({ value: 0.75 });
  });

  it("overdubs a stable staged take, replacing only nearest older same-pitch pairs and preserving new fast attacks", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "set-overdub", enabled: true });
    await h.command({ type: "play" });
    const note = (at: number, pitch: number, velocity: number, length = 30) => {
      h.clock.until(at);
      h.input({ type: "note-on", channel: 0, note: pitch, velocity });
      h.clock.until(at + length);
      h.input({ type: "note-on", channel: 0, note: pitch, velocity: 0 });
    };
    note(200, 60, 50);
    note(240, 64, 60);
    note(700, 60, 70);
    h.clock.until(2_010);
    const id = h.engine.snapshot().capture.staged!.id;
    note(2_210, 60, 90);
    note(2_250, 60, 100);
    note(3_200, 67, 110);
    h.clock.until(4_010);
    expect(h.engine.snapshot().capture.staged!.id).toBe(id);
    expect(h.engine.snapshot().capture.previousStaged).toBeNull();
    const raw = h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording;
    expect(raw.filter(({ event }) => event.type === "note-on" && event.velocity > 0).map(({ position, event }) => [Math.round(position * 2_000), "note" in event && event.note, "velocity" in event && event.velocity])).toEqual([
      [210, 60, 90], [240, 64, 60], [250, 60, 100], [700, 60, 70], [1200, 67, 110],
    ]);
    expect(raw).toHaveLength(10);
    h.clock.until(6_010);
    expect(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording).toEqual(raw);
    note(6_400, 72, 100);
    await h.command({ type: "stop" });
    expect(h.loops.captureSessionTakes(h.engine.snapshot()).staged!.rawRecording).toHaveLength(12);
  });

  it("sets a source marker without interrupting a gate, then starts replay and MIDI at that marker", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "play" });
    h.clock.until(250);
    h.input({ type: "pitch-bend", channel: 0, value: 0.5 });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    h.clock.until(750);
    h.input({ type: "note-off", channel: 0, note: 60 });
    h.clock.until(800);
    h.input({ type: "pitch-bend", channel: 0, value: 0 });
    h.clock.until(2_300);
    const before = structuredClone(h.replay);
    const position = h.engine.snapshot().transport;
    await h.command({ type: "set-loop-start", position: 0.25 });
    expect(h.engine.snapshot().transport).toEqual(position);
    expect(h.replay).toEqual(before);
    h.clock.until(2_800);
    expect(h.replay.find(({ event }) => event.type === "note-off")?.at).toBe(2_750);
    await h.command({ type: "stop" });
    h.replay.length = 0;
    await h.command({ type: "play" });
    h.clock.until(3_100);
    const heard = normalized(h.replay, 2_800);
    expect(heard.slice(0, 3)).toEqual([
      { at: 1, event: { type: "pitch-bend", channel: 0, value: 0.5 } },
      { at: 1, event: { type: "note-on", channel: 0, note: 60, velocity: 80 } },
      { at: 250, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
    const snapshot = h.engine.snapshot();
    const take = snapshot.capture.staged!;
    const source = h.loops.exportRecordings([take.id]).get(take.id)!;
    expect(source.find(({ event }) => event.type === "note-on")?.position).toBe(0.125);
    const midi = parseMidi(recordingToMidi(source, take, snapshot));
    let tick = 0;
    const notes = midi.tracks[1]!.flatMap((event) => {
      tick += event.deltaTime;
      return event.type === "noteOn" || event.type === "noteOff" ? [{ tick, type: event.type }] : [];
    });
    expect(notes).toEqual([{ tick: 0, type: "noteOn" }, { tick: 240, type: "noteOff" }, { tick: 1680, type: "noteOn" }, { tick: 1920, type: "noteOff" }]);
  });

  it("floors positive input after the curve before capture, never releases or replay levels", async () => {
    const h = await host({ enabled: false });
    await h.command({ type: "configure", settings: { velocityCurve: "responsive", minimumVelocity: 70 } });
    await h.command({ type: "configure", settings: { metronomeEnabled: false } });
    await h.command({ type: "play" });
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 2 });
    h.clock.until(100);
    h.input({ type: "note-on", channel: 0, note: 60, velocity: 0 });
    h.clock.until(200);
    h.input({ type: "note-on", channel: 0, note: 64, velocity: 80 });
    h.clock.until(300);
    h.input({ type: "note-off", channel: 0, note: 64 });
    h.clock.until(2_400);
    expect(h.live.map(({ event }) => event)).toEqual([
      { type: "note-on", channel: 0, note: 60, velocity: 70 },
      { type: "note-on", channel: 0, note: 60, velocity: 0 },
      { type: "note-on", channel: 0, note: 64, velocity: 108 },
      { type: "note-off", channel: 0, note: 64 },
    ]);
    expect(normalized(h.replay, 2_000)).toEqual(normalized(h.live, 0, 0.8));
    const take = h.engine.snapshot().capture.staged!;
    expect(h.loops.exportRecordings([take.id]).get(take.id)!.map(({ event }) => event)).toEqual(h.live.map(({ event }) => event));
  });

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
