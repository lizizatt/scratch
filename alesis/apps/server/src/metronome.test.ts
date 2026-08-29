import { describe, expect, it, vi } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import type { AudioOutput } from "@alesis/audio";
import { MetronomeScheduler } from "./metronome.js";

function fakeOutput(): AudioOutput & { playMetronome: ReturnType<typeof vi.fn> } {
  return {
    id: "test",
    name: "Test output",
    start: async () => {},
    dispatchMidi: () => {},
    playMetronome: vi.fn(),
    loadSoundFont: async () => {},
    selectSynth: async () => {},
    setSynthParameter: () => {},
    close: async () => {},
  };
}

describe("MetronomeScheduler", () => {
  it("clicks once per count-in beat and accents the measure start", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MetronomeScheduler(output);
    await engine.execute({ type: "configure", settings: { bpm: 120, beatsPerMeasure: 4, loopMeasures: 1, metronomeVolume: 0.4 } });
    await engine.execute({ type: "play" });

    for (let index = 0; index < 8; index += 1) {
      engine.advance(0.25);
      scheduler.update(engine.snapshot());
    }

    expect(output.playMetronome).toHaveBeenCalledTimes(5);
    expect(output.playMetronome.mock.calls[0]).toEqual([true, 0.4]);
    expect(output.playMetronome.mock.calls.slice(1, 4)).toEqual([[false, 0.4], [false, 0.4], [false, 0.4]]);
    expect(output.playMetronome.mock.calls[4]).toEqual([true, 0.4]);
  });

  it("stays silent when disabled and resumes on the next beat", async () => {
    const engine = new SimulatedHostEngine();
    const output = fakeOutput();
    const scheduler = new MetronomeScheduler(output);
    await engine.execute({ type: "configure", settings: { countInEnabled: false, metronomeEnabled: false } });
    await engine.execute({ type: "play" });
    engine.advance(0.1);
    scheduler.update(engine.snapshot());
    expect(output.playMetronome).not.toHaveBeenCalled();

    await engine.execute({ type: "configure", settings: { metronomeEnabled: true } });
    engine.advance(0.5);
    scheduler.update(engine.snapshot());
    expect(output.playMetronome).toHaveBeenCalledOnce();
  });
});
