import { describe, expect, it, vi } from "vitest";
import type { AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { MidiLoopScheduler, remapMidiEvent } from "./loop-playback.js";

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
});
