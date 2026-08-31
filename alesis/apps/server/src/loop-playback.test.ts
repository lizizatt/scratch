import { describe, expect, it, vi } from "vitest";
import type { AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { MidiLoopScheduler, quantizeRecording, remapMidiEvent } from "./loop-playback.js";

function fakeOutput(): AudioOutput & { dispatchMidi: ReturnType<typeof vi.fn> } {
  return {
    id: "test",
    name: "Test output",
    start: async () => {},
    dispatchMidi: vi.fn(),
    playMetronome: () => {},
    playDrum: () => {},
    loadSoundFont: async () => {},
    selectSoundFontPreset: () => {},
    selectSynth: async () => {},
    setSynthParameter: () => {},
    close: async () => {},
  };
}

function record(engine: SimulatedHostEngine, scheduler: MidiLoopScheduler, event: MidiEvent): void {
  scheduler.record(event, engine.snapshot());
  engine.dispatchMidi(event);
}

describe("MidiLoopScheduler", () => {
  it.each([
    ["1/4", 4, 0.26, 0.25],
    ["1/8", 8, 0.19, 0.25],
    ["1/16", 16, 0.19, 0.1875],
    ["1/32", 32, 0.19, 0.1875],
  ] as const)("aligns %s quantization to the nearest musical bin", (mode, gridSize, input, expected) => {
    const result = quantizeRecording([{ position: input, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } }], mode, 4);

    expect(result).toHaveLength(1);
    expect(result[0]?.position).toBeCloseTo(expected);
    expect(result[0]!.position * gridSize).toBeCloseTo(Math.round(result[0]!.position * gridSize));
  });

  it("leaves timing unchanged when quantization is disabled", () => {
    const recording = [{ position: 0.193, event: { type: "pitch-bend", channel: 0, value: 0.4 } as MidiEvent }];
    expect(quantizeRecording(recording, "off", 4)).toEqual(recording);
  });

  it("deduplicates equivalent events in a bin and keeps the latest value", () => {
    const result = quantizeRecording([
      { position: 0.13, event: { type: "control-change", channel: 0, controller: 1, value: 20 } },
      { position: 0.14, event: { type: "control-change", channel: 0, controller: 1, value: 90 } },
      { position: 0.15, event: { type: "note-on", channel: 0, note: 60, velocity: 70 } },
      { position: 0.16, event: { type: "note-on", channel: 0, note: 60, velocity: 110 } },
    ], "1/4", 4);

    expect(result).toEqual([
      { position: 0.25, event: { type: "control-change", channel: 0, controller: 1, value: 90 } },
      { position: 0.25, event: { type: "note-on", channel: 0, note: 60, velocity: 110 } },
    ]);
  });

  it("preserves a short note for at least one quantization step", () => {
    const result = quantizeRecording([
      { position: 0.13, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { position: 0.14, event: { type: "note-off", channel: 0, note: 60 } },
    ], "1/16", 4);

    expect(result).toEqual([
      { position: 0.125, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { position: 0.1875, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
  });

  it("preserves an audible release when a one-beat loop has only one grid bin", () => {
    const result = quantizeRecording([
      { position: 0.1, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { position: 0.9, event: { type: "note-off", channel: 0, note: 60 } },
    ], "1/4", 1);

    expect(result).toEqual([
      { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { position: 0.5, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
  });

  it("wraps events nearest the loop end onto the first circular bin", () => {
    const result = quantizeRecording([{ position: 0.99, event: { type: "note-off", channel: 0, note: 60 } }], "1/4", 4);
    expect(result[0]?.position).toBe(0);
  });

  it.each(["1/4", "1/8", "1/16", "1/32"] as const)("keeps every %s arrival within half a grid step", (mode) => {
    const subdivisions = { "1/4": 1, "1/8": 2, "1/16": 4, "1/32": 8 }[mode];
    const gridSize = 7 * subdivisions;
    for (let index = 0; index <= 100; index += 1) {
      const input = index / 101;
      const result = quantizeRecording([{ position: input, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } }], mode, 7);
      expect(result).toHaveLength(1);
      const position = result[0]!.position;
      const circularError = Math.min(Math.abs(position - input), 1 - Math.abs(position - input));
      expect(circularError).toBeLessThanOrEqual(0.5 / gridSize + Number.EPSILON);
    }
  });

  it("replays staged input at the nearest selected grid timestamp", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MidiLoopScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "set-quantization", mode: "1/4" });
    await engine.execute({ type: "play" });
    engine.advance(0.52);
    record(engine, scheduler, { type: "note-on", channel: 0, note: 60, velocity: 100 });
    engine.advance(1.48);
    scheduler.update(engine.snapshot());
    output.dispatchMidi.mockClear();

    engine.advance(0.49);
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).not.toHaveBeenCalledWith(expect.objectContaining({ type: "note-on", note: 60 }));
    engine.advance(0.01);
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).toHaveBeenCalledWith({ type: "note-on", channel: 1, note: 60, velocity: 80 });
  });

  it("re-quantizes the current staged take when the mode changes", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MidiLoopScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    engine.advance(0.52);
    record(engine, scheduler, { type: "note-on", channel: 0, note: 60, velocity: 100 });
    engine.advance(1.48);
    scheduler.update(engine.snapshot());
    await engine.execute({ type: "set-quantization", mode: "1/4" });
    scheduler.update(engine.snapshot());
    output.dispatchMidi.mockClear();

    engine.advance(0.49);
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).not.toHaveBeenCalledWith(expect.objectContaining({ type: "note-on", note: 60 }));
    engine.advance(0.01);
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).toHaveBeenCalledWith(expect.objectContaining({ type: "note-on", note: 60 }));
  });

  it("keeps displaced staging silent until it is promoted", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MidiLoopScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    record(engine, scheduler, { type: "note-on", channel: 0, note: 60, velocity: 100 });
    record(engine, scheduler, { type: "note-off", channel: 0, note: 60 });
    engine.advance(2);
    scheduler.update(engine.snapshot());
    output.dispatchMidi.mockClear();
    record(engine, scheduler, { type: "note-on", channel: 0, note: 62, velocity: 100 });
    record(engine, scheduler, { type: "note-off", channel: 0, note: 62 });
    engine.advance(2);
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).not.toHaveBeenCalledWith(expect.objectContaining({ type: "note-on", note: 60 }));
    expect(output.dispatchMidi).toHaveBeenCalledWith(expect.objectContaining({ type: "note-on", note: 62 }));

    await engine.execute({ type: "promote-previous-staged" });
    output.dispatchMidi.mockClear();
    engine.advance(2);
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).toHaveBeenCalledWith(expect.objectContaining({ type: "note-on", note: 60 }));
  });

  it("bounds stored recordings to active, recoverable, and undoable takes", async () => {
    const engine = new SimulatedHostEngine();
    const scheduler = new MidiLoopScheduler(fakeOutput());
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    for (let cycle = 0; cycle < 10; cycle += 1) {
      record(engine, scheduler, { type: "note-on", channel: 0, note: 60 + cycle, velocity: 100 });
      record(engine, scheduler, { type: "note-off", channel: 0, note: 60 + cycle });
      engine.advance(2);
      scheduler.update(engine.snapshot());
    }

    expect(scheduler.storageStats()).toEqual({ recordings: 2, rawRecordings: 1, channels: 2 });
    scheduler.clearRecordings();
    expect(scheduler.storageStats()).toEqual({ recordings: 0, rawRecordings: 0, channels: 0 });
  });

  it("exports defensive copies of requested retained recordings", async () => {
    const engine = new SimulatedHostEngine();
    const scheduler = new MidiLoopScheduler(fakeOutput());
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    scheduler.record({ type: "note-on", channel: 0, note: 60, velocity: 100 }, engine.snapshot());
    engine.advance(2);
    scheduler.update(engine.snapshot());
    const stagedId = engine.snapshot().capture.staged!.id;
    const exported = scheduler.exportRecordings([stagedId]);

    expect(exported.get(stagedId)).toEqual([
      { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { position: 1, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
    exported.get(stagedId)![0]!.position = 0.5;
    expect(scheduler.exportRecordings([stagedId]).get(stagedId)?.[0]?.position).toBe(0);
  });

  it("retains the completed cycle when a generated event arrives before the rollover update", async () => {
    const engine = new SimulatedHostEngine();
    const scheduler = new MidiLoopScheduler(fakeOutput());
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    scheduler.record({ type: "note-on", channel: 0, note: 60, velocity: 100 }, engine.snapshot());
    scheduler.record({ type: "note-off", channel: 0, note: 60 }, engine.snapshot());

    engine.advance(2);
    scheduler.record({ type: "note-on", channel: 0, note: 64, velocity: 100 }, engine.snapshot());
    scheduler.update(engine.snapshot());

    const stagedId = engine.snapshot().capture.staged!.id;
    expect(scheduler.exportRecordings([stagedId]).get(stagedId)).toEqual([
      { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
      { position: 0, event: { type: "note-off", channel: 0, note: 60 } },
    ]);
  });

  it("replays a completed cycle as an audible staged take", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MidiLoopScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });

    record(engine, scheduler, { type: "note-on", channel: 0, note: 60, velocity: 100 });
    engine.advance(0.5);
    scheduler.update(engine.snapshot());
    record(engine, scheduler, { type: "note-off", channel: 0, note: 60 });
    engine.advance(1.5);
    scheduler.update(engine.snapshot());

    expect(engine.snapshot().capture.staged).not.toBeNull();
    expect(output.dispatchMidi).toHaveBeenLastCalledWith({ type: "note-on", channel: 1, note: 60, velocity: 80 });

    engine.advance(0.5);
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).toHaveBeenLastCalledWith({ type: "note-off", channel: 1, note: 60 });
  });

  it("preserves promoted playback and releases it immediately when muted", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MidiLoopScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    record(engine, scheduler, { type: "note-on", channel: 0, note: 64, velocity: 100 });
    engine.advance(2);
    scheduler.update(engine.snapshot());
    await engine.execute({ type: "promote-staged" });
    const takeId = engine.snapshot().promoted[0]!.id;
    await engine.execute({ type: "set-take-level", takeId, level: 0.5 });

    engine.advance(2);
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).toHaveBeenLastCalledWith({ type: "note-on", channel: 1, note: 64, velocity: 50 });

    await engine.execute({ type: "set-take-muted", takeId, muted: true });
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).toHaveBeenLastCalledWith({ type: "note-off", channel: 1, note: 64 });
  });

  it("suppresses and releases loop playback in monitor-only mode", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MidiLoopScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    record(engine, scheduler, { type: "note-on", channel: 0, note: 67, velocity: 100 });
    engine.advance(2);
    scheduler.update(engine.snapshot());
    output.dispatchMidi.mockClear();

    await engine.execute({ type: "set-monitor-only", enabled: true });
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).toHaveBeenCalledWith({ type: "note-off", channel: 1, note: 67 });
  });

  it("releases a sounding staged take when staged audition is muted", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MidiLoopScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    record(engine, scheduler, { type: "note-on", channel: 0, note: 69, velocity: 100 });
    engine.advance(2);
    scheduler.update(engine.snapshot());

    await engine.execute({ type: "set-staged-audible", audible: false });
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).toHaveBeenLastCalledWith({ type: "note-off", channel: 1, note: 69 });
  });

  it("releases held playback notes before retriggering them at a cycle boundary", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MidiLoopScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    record(engine, scheduler, { type: "note-on", channel: 0, note: 72, velocity: 100 });
    engine.advance(2);
    scheduler.update(engine.snapshot());
    output.dispatchMidi.mockClear();

    engine.advance(2);
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi.mock.calls.map(([event]) => event)).toEqual([
      { type: "note-off", channel: 1, note: 72 },
      { type: "note-on", channel: 2, note: 72, velocity: 80 },
    ]);
  });

  it("remaps expressive events without changing their payload", () => {
    expect(remapMidiEvent({ type: "note-on", channel: 0, note: 60, velocity: 101 }, 4, 0.5)).toEqual({ type: "note-on", channel: 4, note: 60, velocity: 51 });
    expect(remapMidiEvent({ type: "pitch-bend", channel: 0, value: 0.25 }, 4, 0.5)).toEqual({ type: "pitch-bend", channel: 4, value: 0.25 });
    expect(remapMidiEvent({ type: "control-change", channel: 0, controller: 64, value: 127 }, 4, 0.5)).toEqual({ type: "control-change", channel: 4, controller: 64, value: 127 });
  });

  it("preserves the General MIDI percussion channel during loop playback", () => {
    expect(remapMidiEvent({ type: "note-on", channel: 9, note: 36, velocity: 110 }, 4, 0.8)).toEqual({ type: "note-on", channel: 9, note: 36, velocity: 88 });
    expect(remapMidiEvent({ type: "note-off", channel: 9, note: 36 }, 4, 0.8)).toEqual({ type: "note-off", channel: 9, note: 36 });
  });

  it("routes pitch bend to the take channel and provides a centered reset", () => {
    expect(remapMidiEvent({ type: "pitch-bend", channel: 0, value: -0.75 }, 4, 0.8)).toEqual({ type: "pitch-bend", channel: 4, value: -0.75 });
    expect(remapMidiEvent({ type: "pitch-bend", channel: 9, value: 0.5 }, 4, 0.8)).toEqual({ type: "pitch-bend", channel: 9, value: 0.5 });
    expect(remapMidiEvent({ type: "pitch-bend", channel: 0, value: 2 }, 4, 0.8)).toEqual({ type: "pitch-bend", channel: 4, value: 1 });
  });

  it("replays promoted drum pads on percussion while routing and resetting melodic pitch bend", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MidiLoopScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    record(engine, scheduler, { type: "note-on", channel: 9, note: 36, velocity: 110 });
    record(engine, scheduler, { type: "pitch-bend", channel: 0, value: 0.75 });
    engine.advance(0.25);
    scheduler.update(engine.snapshot());
    record(engine, scheduler, { type: "note-off", channel: 9, note: 36 });
    engine.advance(1.75);
    scheduler.update(engine.snapshot());
    await engine.execute({ type: "promote-staged" });
    const takeId = engine.snapshot().promoted[0]!.id;
    output.dispatchMidi.mockClear();

    engine.advance(2);
    scheduler.update(engine.snapshot());
    const events = output.dispatchMidi.mock.calls.map(([event]) => event);
    expect(events).toContainEqual({ type: "note-on", channel: 9, note: 36, velocity: 88 });
    expect(events).toContainEqual({ type: "pitch-bend", channel: 1, value: 0.75 });
    expect(events.indexOf(events.find((event) => event.type === "pitch-bend" && event.value === 0)!)).toBeLessThan(events.indexOf(events.find((event) => event.type === "pitch-bend" && event.value === 0.75)!));

    await engine.execute({ type: "set-take-muted", takeId, muted: true });
    scheduler.update(engine.snapshot());
    expect(output.dispatchMidi).toHaveBeenLastCalledWith({ type: "pitch-bend", channel: 1, value: 0 });
  });
});
