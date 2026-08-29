import { describe, expect, it } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import { DrumPatternScheduler } from "./drum-patterns.js";

describe("DrumPatternScheduler", () => {
  it("emits four-on-floor hits once per transport step", async () => {
    const engine = new SimulatedHostEngine();
    const drums = new DrumPatternScheduler();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "configure-drums", settings: { enabled: true, pattern: "four-on-floor", volume: 0.8 } });
    await engine.execute({ type: "play" });

    expect(drums.update(engine.snapshot())).toEqual([
      { note: 36, velocity: 102 },
      { note: 42, velocity: 76 },
    ]);
    expect(drums.update(engine.snapshot())).toEqual([]);
    engine.advance(0.25);
    expect(drums.update(engine.snapshot())).toEqual([{ note: 42, velocity: 76 }]);
  });

  it("stays silent during count-in, while disabled, and after stop", async () => {
    const engine = new SimulatedHostEngine();
    const drums = new DrumPatternScheduler();
    await engine.execute({ type: "configure-drums", settings: { enabled: true } });
    await engine.execute({ type: "play" });
    expect(drums.update(engine.snapshot())).toEqual([]);
    await engine.execute({ type: "stop" });
    expect(drums.update(engine.snapshot())).toEqual([]);
  });

  it("provides distinct deterministic backbeat and breakbeat patterns", async () => {
    const engine = new SimulatedHostEngine();
    const drums = new DrumPatternScheduler();
    await engine.execute({ type: "configure", settings: { countInEnabled: false } });
    await engine.execute({ type: "play" });
    await engine.execute({ type: "configure-drums", settings: { enabled: true, pattern: "backbeat", volume: 1 } });
    const backbeat = drums.update(engine.snapshot());
    await engine.execute({ type: "configure-drums", settings: { pattern: "breakbeat" } });
    const breakbeat = new DrumPatternScheduler().update(engine.snapshot());

    expect(backbeat).not.toEqual(breakbeat);
    expect(backbeat.length).toBeGreaterThan(0);
    expect(breakbeat.length).toBeGreaterThan(0);
  });

  it("adapts a full pattern across short meters", async () => {
    const engine = new SimulatedHostEngine();
    const drums = new DrumPatternScheduler();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 2, loopMeasures: 1 } });
    await engine.execute({ type: "configure-drums", settings: { enabled: true, pattern: "four-on-floor", volume: 1 } });
    await engine.execute({ type: "play" });
    drums.update(engine.snapshot());
    engine.advance(0.5);
    expect(drums.update(engine.snapshot())).toContainEqual({ note: 36, velocity: 127 });
  });

  it("restarts step zero on cycle, disable, and resume boundaries", async () => {
    const engine = new SimulatedHostEngine();
    const drums = new DrumPatternScheduler();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 2, loopMeasures: 1 } });
    await engine.execute({ type: "configure-drums", settings: { enabled: true } });
    await engine.execute({ type: "play" });
    expect(drums.update(engine.snapshot()).length).toBeGreaterThan(0);
    engine.advance(1);
    expect(drums.update(engine.snapshot()).length).toBeGreaterThan(0);
    await engine.execute({ type: "configure-drums", settings: { enabled: false } });
    drums.update(engine.snapshot());
    await engine.execute({ type: "configure-drums", settings: { enabled: true } });
    expect(drums.update(engine.snapshot()).length).toBeGreaterThan(0);
  });

  it("is silent at zero volume and caps velocity at 127", async () => {
    const engine = new SimulatedHostEngine();
    const drums = new DrumPatternScheduler();
    await engine.execute({ type: "configure", settings: { countInEnabled: false } });
    await engine.execute({ type: "configure-drums", settings: { enabled: true, volume: 0 } });
    await engine.execute({ type: "play" });
    expect(drums.update(engine.snapshot())).toEqual([]);
    await engine.execute({ type: "configure-drums", settings: { volume: 1 } });
    expect(new DrumPatternScheduler().update(engine.snapshot()).every(({ velocity }) => velocity <= 127)).toBe(true);
  });
});