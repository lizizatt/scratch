import { describe, expect, it } from "vitest";
import { SimulatedHostEngine } from "./index.js";

async function captureOneCycle(engine: SimulatedHostEngine): Promise<void> {
  await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
  await engine.execute({ type: "play" });
  engine.dispatchMidi({ type: "note-on", channel: 0, note: 60, velocity: 100 });
  engine.advance(2);
}

describe("SimulatedHostEngine", () => {
  it("publishes observable normalized MIDI activity", () => {
    const engine = new SimulatedHostEngine();
    engine.dispatchMidi({ type: "pitch-bend", channel: 0, value: 0.5 });

    expect(engine.snapshot().engine).toMatchObject({ midiEventsReceived: 1, lastMidiEvent: "pitch-bend" });
  });

  it("counts in, captures, and rolls a cycle into staging", async () => {
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });

    expect(engine.snapshot().transport.state).toBe("counting-in");
    engine.advance(2);
    expect(engine.snapshot().transport.state).toBe("playing");
    engine.advance(2);

    expect(engine.snapshot().capture.staged).toMatchObject({ cycle: 0, muted: false });
    expect(engine.snapshot().transport.cycle).toBe(1);
  });

  it("promotes a staged take and clears staging", async () => {
    const engine = new SimulatedHostEngine();
    await captureOneCycle(engine);
    const result = await engine.execute({ type: "promote-staged" });

    expect(result.accepted).toBe(true);
    expect(engine.snapshot().capture.staged).toBeNull();
    expect(engine.snapshot().promoted).toHaveLength(1);
  });

  it("requires explicit clearing for timing changes with audio", async () => {
    const engine = new SimulatedHostEngine();
    await captureOneCycle(engine);
    await engine.execute({ type: "promote-staged" });

    const rejected = await engine.execute({ type: "configure", settings: { bpm: 90 } });
    expect(rejected).toMatchObject({ accepted: false });
    expect(engine.snapshot().settings.bpm).toBe(120);
    expect(engine.snapshot().promoted).toHaveLength(1);

    const accepted = await engine.execute({ type: "configure", settings: { bpm: 90 }, clearAudio: true });
    expect(accepted.accepted).toBe(true);
    expect(engine.snapshot().promoted).toHaveLength(0);
    expect(engine.snapshot().settings.bpm).toBe(90);
  });

  it("deletes immediately and restores only the latest deleted take", async () => {
    const engine = new SimulatedHostEngine();
    await captureOneCycle(engine);
    await engine.execute({ type: "promote-staged" });
    const takeId = engine.snapshot().promoted[0]?.id;
    expect(takeId).toBeDefined();

    await engine.execute({ type: "set-take-level", takeId: takeId!, level: 0.55 });
    await engine.execute({ type: "set-take-muted", takeId: takeId!, muted: true });
    await engine.execute({ type: "delete-take", takeId: takeId! });
    expect(engine.snapshot()).toMatchObject({ promoted: [], canUndoDelete: true });

    await engine.execute({ type: "undo-delete" });
    expect(engine.snapshot().promoted[0]).toMatchObject({ id: takeId, level: 0.55, muted: true });
  });

  it("stops by discarding partial capture while retaining staged audio", async () => {
    const engine = new SimulatedHostEngine();
    await captureOneCycle(engine);
    const stagedId = engine.snapshot().capture.staged?.id;
    engine.advance(0.5);
    await engine.execute({ type: "stop" });

    expect(engine.snapshot().transport).toMatchObject({ state: "stopped", progress: 0 });
    expect(engine.snapshot().capture.currentWaveform).toEqual([]);
    expect(engine.snapshot().capture.staged?.id).toBe(stagedId);
  });
});
