import { describe, expect, it } from "vitest";
import { SimulatedHostEngine } from "./index.js";

const piano = { soundFontId: "font", presetId: "0:0", bank: 0, program: 0, name: "Piano" };
const violin = { soundFontId: "font", presetId: "0:40", bank: 0, program: 40, name: "Violin" };

async function voiceEngine(synthId = "soundfont") {
  const engine = new SimulatedHostEngine({
    soundFonts: [{ id: "font", name: "Font" }],
    soundFontPresets: [
      { id: "0:0", bank: 0, program: 0, name: "Piano" },
      { id: "0:40", bank: 0, program: 40, name: "Violin" },
    ],
    selectedSoundFontPresetId: "0:0",
  });
  await engine.execute({ type: "select-synth", synthId });
  await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
  return engine;
}

const select = (engine: SimulatedHostEngine, presetId: string) => engine.execute({ type: "select-soundfont-preset", presetId });

describe("take voices", () => {
  it("keeps the voice active when the pass ended, not the voice selected afterward", async () => {
    const engine = await voiceEngine();
    await engine.execute({ type: "play" });
    engine.advance(1);
    await select(engine, "0:40");
    engine.advance(1);
    expect(engine.snapshot().capture.staged?.voice).toEqual(violin);

    await select(engine, "0:0");
    engine.advance(2);
    expect(engine.snapshot().capture.staged?.voice).toEqual(piano);
    expect(engine.snapshot().capture.previousStaged?.voice).toEqual(violin);
  });

  it("freezes the voice on promotion and promoted takes ignore later voice changes", async () => {
    const engine = await voiceEngine();
    await engine.execute({ type: "play" });
    engine.advance(2);
    await engine.execute({ type: "promote-staged" });
    await select(engine, "0:40");
    engine.advance(2);
    await engine.execute({ type: "promote-staged" });
    await select(engine, "0:0");

    expect(engine.snapshot().promoted.map(({ voice }) => voice)).toEqual([piano, violin]);
  });

  it("freezes the previous staged voice when it is promoted", async () => {
    const engine = await voiceEngine();
    await engine.execute({ type: "play" });
    engine.advance(2);
    await select(engine, "0:40");
    engine.advance(2);
    await engine.execute({ type: "promote-previous-staged" });

    expect(engine.snapshot().promoted[0]?.voice).toEqual(piano);
    expect(engine.snapshot().capture.staged?.voice).toEqual(violin);
  });

  it("does not re-voice the staged take outside overdub", async () => {
    const engine = await voiceEngine();
    await engine.execute({ type: "play" });
    engine.advance(2);
    await select(engine, "0:40");

    expect(engine.snapshot().capture.staged?.voice).toEqual(piano);
  });

  it("re-voices only the staged take while overdubbing and leaves the previous take alone", async () => {
    const engine = await voiceEngine();
    await engine.execute({ type: "play" });
    engine.advance(4);
    await engine.execute({ type: "set-overdub", enabled: true });
    const previous = engine.snapshot().capture.previousStaged;
    const stagedId = engine.snapshot().capture.staged?.id;

    await select(engine, "0:40");
    expect(engine.snapshot().capture.staged).toMatchObject({ id: stagedId, voice: violin });
    expect(engine.snapshot().capture.previousStaged).toEqual(previous);

    engine.advance(2);
    await select(engine, "0:0");
    engine.advance(2);
    expect(engine.snapshot().capture.staged).toMatchObject({ id: stagedId, voice: piano });
    await engine.execute({ type: "promote-staged" });
    await select(engine, "0:40");
    expect(engine.snapshot().promoted[0]?.voice).toEqual(piano);
  });

  it("adopts the current voice when overdub is enabled and when the SoundFont changes", async () => {
    const engine = await voiceEngine();
    await engine.execute({ type: "play" });
    engine.advance(2);
    await select(engine, "0:40");
    expect(engine.snapshot().capture.staged?.voice).toEqual(piano);

    await engine.execute({ type: "set-overdub", enabled: true });
    expect(engine.snapshot().capture.staged?.voice).toEqual(violin);

    engine.replaceSoundFontSelection("font", [{ id: "5:3", bank: 5, program: 3, name: "Pad" }], "5:3");
    expect(engine.snapshot().capture.staged?.voice).toEqual({ soundFontId: "font", presetId: "5:3", bank: 5, program: 3, name: "Pad" });
  });

  it("follows voice navigation from hardware pads while overdubbing", async () => {
    const engine = await voiceEngine();
    await engine.execute({ type: "set-overdub", enabled: true });
    await engine.execute({ type: "play" });
    engine.advance(2);
    expect((await engine.execute({ type: "step-pad-navigation", direction: 1 })).accepted).toBe(true);

    expect(engine.snapshot().capture.staged?.voice).toEqual(violin);
  });

  it("records no voice for the Neon synth and drops it if overdub switches to Neon", async () => {
    const neon = await voiceEngine("subtractive");
    await neon.execute({ type: "play" });
    neon.advance(2);
    expect(neon.snapshot().capture.staged).not.toHaveProperty("voice");

    const engine = await voiceEngine();
    await engine.execute({ type: "set-overdub", enabled: true });
    await engine.execute({ type: "play" });
    engine.advance(2);
    expect(engine.snapshot().capture.staged?.voice).toEqual(piano);
    await engine.execute({ type: "select-synth", synthId: "subtractive" });
    expect(engine.snapshot().capture.staged).not.toHaveProperty("voice");
  });

  it("exposes detached voices through the runtime view", async () => {
    const engine = await voiceEngine();
    await engine.execute({ type: "play" });
    engine.advance(2);
    const runtime = engine.runtimeSnapshot();
    runtime.capture.staged!.voice!.name = "Changed";

    expect(engine.runtimeSnapshot().capture.staged?.voice).toEqual(piano);
    expect(engine.snapshot().capture.staged?.voice).toEqual(piano);
  });
});
