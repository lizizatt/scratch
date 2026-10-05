import { describe, expect, it } from "vitest";
import { engineSnapshotSchema } from "@alesis/protocol";
import { SimulatedHostEngine } from "./index.js";

async function captureOneCycle(engine: SimulatedHostEngine): Promise<void> {
  await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
  await engine.execute({ type: "play" });
  engine.dispatchMidi({ type: "note-on", channel: 0, note: 60, velocity: 100 });
  engine.advance(2);
}

describe("SimulatedHostEngine", () => {
  it("returns the revision published in the authoritative snapshot", async () => {
    const engine = new SimulatedHostEngine();

    const result = await engine.execute({ type: "configure", settings: { bpm: 96 } });

    expect(result.revision).toBe(engine.snapshot().revision);
  });

  it("rejects loop sample export without the host sample service", async () => {
    const engine = new SimulatedHostEngine();

    await expect(engine.execute({ type: "export-loop-sample" })).resolves.toMatchObject({
      accepted: false,
      error: "Loop sample export requires the host sample service",
    });
  });

  it("does not publish unchanged snapshots while transport is stopped", () => {
    const engine = new SimulatedHostEngine();
    let snapshots = 0;
    engine.subscribe(() => { snapshots += 1; });

    engine.advance(0.05);

    expect(snapshots).toBe(1);
  });

  it("owns validated arpeggiator configuration", async () => {
    const engine = new SimulatedHostEngine();
    const result = await engine.execute({ type: "configure-arpeggiator", settings: { enabled: true, mode: "up-down", rate: "1/16", octaves: 3, gate: 0.7, latch: true, swing: 0.2 } });

    expect(result.accepted).toBe(true);
    expect(engine.snapshot().arpeggiator).toEqual({ enabled: true, mode: "up-down", rate: "1/16", octaves: 3, gate: 0.7, latch: true, swing: 0.2 });
  });

  it("rejects drum volume outside the MIDI-safe range", async () => {
    const engine = new SimulatedHostEngine();
    expect((await engine.execute({ type: "configure-drums", settings: { volume: 1.1 } })).accepted).toBe(false);
    expect(engine.snapshot().drums.volume).toBe(0.7);
  });

  it("populates exactly the selected instrument controls with defaults", async () => {
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "set-synth-parameter", parameterId: "cutoff", value: 12_000 });
    await engine.execute({ type: "select-synth", synthId: "soundfont" });

    const snapshot = engine.snapshot();
    const instrument = snapshot.synth.instruments.find(({ id }) => id === snapshot.synth.selectedId)!;
    expect(Object.keys(snapshot.synth.parameterValues).sort()).toEqual(instrument.controls.map(({ id }) => id).sort());
    expect(snapshot.synth.parameterValues.gain).toBe(0.72);
    expect(snapshot.synth.parameterValues.cutoff).toBeUndefined();
  });

  it("exposes Reverb Mix through 100 percent", async () => {
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "select-synth", synthId: "soundfont" });
    const instrument = engine.snapshot().synth.instruments.find(({ id }) => id === "soundfont")!;
    const parameterId = "reverb-send";
    expect(instrument.controls.find(({ id }) => id === parameterId)).toMatchObject({ label: "Reverb Mix", minimum: 0, maximum: 1, unit: "%" });
    expect(instrument.controls.some(({ id }) => id.startsWith("chorus-"))).toBe(false);

    for (const value of [0, 0.5, 0.75, 1]) {
      expect((await engine.execute({ type: "set-synth-parameter", parameterId, value })).accepted).toBe(true);
      expect(engine.snapshot().synth.parameterValues[parameterId]).toBe(value);
    }
    for (const value of [-0.01, 1.01]) {
      expect((await engine.execute({ type: "set-synth-parameter", parameterId, value })).accepted).toBe(false);
      expect(engine.snapshot().synth.parameterValues[parameterId]).toBe(1);
    }
  });

  it("selects only SoundFonts from the host catalog", async () => {
    const engine = new SimulatedHostEngine({
      soundFonts: [{ id: "sonic", name: "Sonic" }, { id: "fluid", name: "FluidR3" }],
      selectedSoundFontId: "sonic",
    });

    expect(engine.snapshot().synth.selectedSoundFontId).toBe("sonic");
    expect((await engine.execute({ type: "select-soundfont", soundFontId: "fluid" })).accepted).toBe(true);
    expect(engine.snapshot().synth.selectedSoundFontId).toBe("fluid");
    expect((await engine.execute({ type: "select-soundfont", soundFontId: "missing" })).accepted).toBe(false);
    expect(engine.snapshot().synth.selectedSoundFontId).toBe("fluid");
  });

  it("limits pad voice navigation to the selected bank and ignores out-of-range programs", async () => {
    const presets = [
      { id: "5:40", bank: 5, program: 40, name: "Zeta" },
      { id: "2:1", bank: 2, program: 1, name: "Other bank" },
      { id: "5:3", bank: 5, program: 3, name: "Alpha" },
    ];
    const engine = new SimulatedHostEngine({ soundFontPresets: presets, selectedSoundFontPresetId: "5:40" });

    expect(engine.snapshot().pads).toMatchObject({ navigationTarget: "voices", navigationIndex: 1, navigationCount: 2 });
    expect((await engine.execute({ type: "select-pad-program", program: 0 })).accepted).toBe(true);
    expect(engine.snapshot().synth.selectedSoundFontPresetId).toBe("5:3");
    expect(engine.snapshot().synth.soundFontPresets.find(({ id }) => id === engine.snapshot().synth.selectedSoundFontPresetId)?.bank).toBe(5);
    expect((await engine.execute({ type: "select-pad-program", program: 2 })).accepted).toBe(false);
    expect(engine.snapshot().synth.selectedSoundFontPresetId).toBe("5:3");
  });

  it("wraps kit navigation server-side and updates the selected kit", async () => {
    const engine = new SimulatedHostEngine({
      drumKits: [
        { id: "kit-2", bank: 128, program: 2, name: "Two" },
        { id: "kit-0", bank: 128, program: 0, name: "Zero" },
      ],
    });
    await engine.execute({ type: "set-pad-navigation-target", target: "drum-kits" });

    expect(engine.snapshot().pads).toMatchObject({ navigationIndex: 1, navigationCount: 2, selectedDrumKitId: "kit-2" });
    expect((await engine.execute({ type: "step-pad-navigation", direction: 1 })).accepted).toBe(true);
    expect(engine.snapshot().pads).toMatchObject({ navigationIndex: 0, selectedDrumKitId: "kit-0" });
    expect((await engine.execute({ type: "step-pad-navigation", direction: -1 })).accepted).toBe(true);
    expect(engine.snapshot().pads).toMatchObject({ navigationIndex: 1, selectedDrumKitId: "kit-2" });
  });

  it("tracks exactly eight sample pads and wraps sample page navigation", async () => {
    const engine = new SimulatedHostEngine();
    engine.setSamplePage(0, 3, [
      { id: "sample-a", name: "A", pad: 0 },
      null, null, null, null, null, null, null,
    ]);
    await engine.execute({ type: "set-pad-mode", mode: "samples" });
    await engine.execute({ type: "set-pad-navigation-target", target: "sample-pages" });

    expect(engine.snapshot().pads.samplePage).toHaveLength(8);
    expect(engine.snapshot().pads.samplePage[0]).toEqual({ id: "sample-a", name: "A", pad: 0 });
    expect((await engine.execute({ type: "select-pad-program", program: 2 })).accepted).toBe(true);
    expect(engine.snapshot().pads.samplePageIndex).toBe(2);
    expect((await engine.execute({ type: "step-pad-navigation", direction: 1 })).accepted).toBe(true);
    expect(engine.snapshot().pads.samplePageIndex).toBe(0);
  });

  it("replaces the SoundFont catalog while preserving a valid selection", () => {
    const engine = new SimulatedHostEngine({ soundFonts: [{ id: "sonic", name: "Sonic" }], selectedSoundFontId: "sonic" });
    const result = engine.replaceSoundFonts([
      { id: "sonic", name: "Sonic" },
      { id: "new-bank", name: "New Bank" },
    ], "sonic");

    expect(result.accepted).toBe(true);
    expect(engine.snapshot().synth).toMatchObject({
      selectedSoundFontId: "sonic",
      soundFonts: [{ id: "sonic", name: "Sonic" }, { id: "new-bank", name: "New Bank" }],
    });
  });

  it("atomically replaces SoundFont and named preset selection", async () => {
    const engine = new SimulatedHostEngine({ soundFonts: [{ id: "one", name: "One" }, { id: "two", name: "Two" }] });
    const presets = [{ id: "0:3", bank: 0, program: 3, name: "Lead" }];

    expect(engine.replaceSoundFontSelection("two", presets, "0:3").accepted).toBe(true);
    expect(engine.snapshot().synth).toMatchObject({ selectedSoundFontId: "two", soundFontPresets: presets, selectedSoundFontPresetId: "0:3" });
    expect((await engine.execute({ type: "select-soundfont-preset", presetId: "missing" })).accepted).toBe(false);
    expect((await engine.execute({ type: "select-soundfont-preset", presetId: "0:3" })).accepted).toBe(true);
  });

  it("starts with the metronome enabled at 25 percent", () => {
    const engine = new SimulatedHostEngine();

    expect(engine.snapshot().settings).toMatchObject({ metronomeEnabled: true, metronomeVolume: 0.25 });
  });

  it("defaults to strong key response and accepts curve changes", async () => {
    const engine = new SimulatedHostEngine();
    expect(engine.snapshot().settings.velocityCurve).toBe("strong");

    await engine.execute({ type: "configure", settings: { velocityCurve: "linear" } });

    expect(engine.snapshot().settings.velocityCurve).toBe("linear");
  });

  it("publishes observable normalized MIDI activity", () => {
    const engine = new SimulatedHostEngine();
    engine.dispatchMidi({ type: "pitch-bend", channel: 0, value: 0.5 });

    expect(engine.snapshot().engine).toMatchObject({ midiEventsReceived: 1, lastMidiEvent: "pitch-bend" });
  });

  it("reports current capture activity until the cycle rolls over", async () => {
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });

    engine.dispatchMidi({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    expect(engine.snapshot().capture.hasCurrentEvents).toBe(true);

    engine.advance(2);
    expect(engine.snapshot().capture.hasCurrentEvents).toBe(false);
  });

  it("counts in, captures, and rolls a cycle into staging", async () => {
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });

    expect(engine.snapshot().transport.state).toBe("counting-in");
    engine.advance(0.5);
    expect(engine.snapshot().transport.progress).toBeCloseTo(0.25);
    engine.advance(1.5);
    expect(engine.snapshot().transport.state).toBe("playing");
    engine.advance(2);

    expect(engine.snapshot().capture.staged).toMatchObject({ cycle: 0, muted: false });
    expect(engine.snapshot().capture.previousStaged).toBeNull();
    expect(engine.snapshot().transport.cycle).toBe(1);
  });

  it("owns the selected quantization mode", async () => {
    const engine = new SimulatedHostEngine();
    expect(engine.snapshot().capture.quantization).toBe("off");
    expect((await engine.execute({ type: "set-quantization", mode: "1/16" })).accepted).toBe(true);
    expect(engine.snapshot().capture.quantization).toBe("1/16");
  });

  it.each([90, 137])("publishes elapsed-seconds-preserving progress immediately at %i BPM", async (bpm) => {
    const engine = new SimulatedHostEngine();
    expect((await engine.execute({ type: "configure", settings: { bpm: 120, countInEnabled: false, loopMeasures: 1 } })).accepted).toBe(true);
    expect((await engine.execute({ type: "play" })).accepted).toBe(true);
    engine.advance(0.187);
    const published: ReturnType<typeof engine.snapshot>[] = [];
    const unsubscribe = engine.subscribe((snapshot) => published.push(snapshot));
    published.length = 0;

    const result = await engine.execute({ type: "configure", settings: { bpm } });
    expect(result.accepted).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]!.transport.progress).toBeCloseTo(0.187 / (240 / bpm), 10);
    expect(published[0]!.revision).toBe(result.revision);
    engine.advance(0);
    expect(engine.snapshot().transport).toEqual(published[0]!.transport);
    engine.advance(0.013);
    expect(engine.snapshot().transport.progress).toBeCloseTo(0.2 / (240 / bpm), 10);
    unsubscribe();
  });

  it.each([
    { settings: { bpm: 240 }, elapsed: 3, duration: 2, cycles: 1 },
    { settings: { loopMeasures: 1 }, elapsed: 3, duration: 2, cycles: 1 },
    { settings: { beatsPerMeasure: 2 }, elapsed: 3, duration: 2, cycles: 1 },
    { settings: { loopMeasures: 1 }, elapsed: 2, duration: 2, cycles: 1 },
    { settings: { beatsPerMeasure: 1, loopMeasures: 1 }, elapsed: 3.25, duration: 0.5, cycles: 6 },
  ])("normalizes shortened timing $settings with elapsed $elapsed before publishing", async ({ settings, elapsed, duration, cycles }) => {
    const engine = new SimulatedHostEngine();
    expect((await engine.execute({ type: "configure", settings: { bpm: 120, countInEnabled: false, loopMeasures: 2 } })).accepted).toBe(true);
    expect((await engine.execute({ type: "play" })).accepted).toBe(true);
    engine.dispatchMidi({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    engine.advance(elapsed);
    expect(engine.snapshot().capture.staged).toBeNull();
    const published: ReturnType<typeof engine.snapshot>[] = [];
    const unsubscribe = engine.subscribe((snapshot) => published.push(snapshot));
    published.length = 0;

    const result = await engine.execute({ type: "configure", settings });
    expect(result).toMatchObject({ accepted: true, appliedCycle: cycles });
    expect(published).toHaveLength(1);
    const snapshot = published[0]!;
    expect(engineSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.transport.cycle).toBe(cycles);
    expect(snapshot.transport.progress).toBeCloseTo((elapsed - cycles * duration) / duration, 10);
    expect(snapshot.capture.staged).toMatchObject({ cycle: cycles - 1 });
    if (cycles > 1) expect(snapshot.capture.previousStaged).toMatchObject({ cycle: cycles - 2 });
    expect(snapshot.capture.hasCurrentEvents).toBe(false);
    if (snapshot.transport.progress > 0) expect(snapshot.capture.currentWaveform[0]).toBeGreaterThan(0);
    expect(snapshot.revision).toBe(result.revision);
    engine.advance(0);
    expect(engine.snapshot()).toEqual(snapshot);
    engine.advance(0.01);
    expect(engine.snapshot().transport.progress).toBeCloseTo((elapsed - cycles * duration + 0.01) / duration, 10);
    unsubscribe();
  });

  it.each([90, 240])("updates count-in progress at %i BPM without changing its remaining seconds", async (bpm) => {
    const engine = new SimulatedHostEngine();
    expect((await engine.execute({ type: "configure", settings: { bpm: 120, countInEnabled: true } })).accepted).toBe(true);
    expect((await engine.execute({ type: "play" })).accepted).toBe(true);
    engine.advance(0.5); // 1.5 seconds remain, even when the new measure is shorter.
    expect((await engine.execute({ type: "configure", settings: { bpm } })).accepted).toBe(true);
    const snapshot = engine.snapshot();
    expect(snapshot.transport).toMatchObject({ state: "counting-in", progress: Math.max(0, 1 - 1.5 / (240 / bpm)) });
    expect(engineSnapshotSchema.safeParse(snapshot).success).toBe(true);
    engine.advance(0);
    expect(engine.snapshot().transport).toEqual(snapshot.transport);
    engine.advance(1.5);
    expect(engine.snapshot().transport).toMatchObject({ state: "playing", progress: 0 });
  });

  it("keeps clearAudio's reset instead of rolling elapsed time into the shorter duration", async () => {
    const engine = new SimulatedHostEngine();
    await captureOneCycle(engine);
    engine.advance(1.75);
    expect((await engine.execute({ type: "configure", settings: { bpm: 240 }, clearAudio: true })).accepted).toBe(true);
    expect(engine.snapshot().transport).toEqual({ state: "playing", cycle: 0, progress: 0 });
    expect(engine.snapshot().capture).toMatchObject({ staged: null, previousStaged: null, currentWaveform: [], hasCurrentEvents: false });
  });

  it("keeps an overwritten staged take for one cycle and allows recovery promotion", async () => {
    const engine = new SimulatedHostEngine();
    await captureOneCycle(engine);
    const firstId = engine.snapshot().capture.staged!.id;
    engine.advance(2);
    expect(engine.snapshot().capture.previousStaged).toMatchObject({ id: firstId, cycle: 0 });

    expect((await engine.execute({ type: "promote-previous-staged" })).accepted).toBe(true);
    expect(engine.snapshot().promoted[0]).toMatchObject({ id: firstId, muted: false });
    expect(engine.snapshot().capture.previousStaged).toBeNull();
  });

  it("expires the previous staged take at the next rollover", async () => {
    const engine = new SimulatedHostEngine();
    await captureOneCycle(engine);
    engine.advance(2);
    const recoverableId = engine.snapshot().capture.previousStaged!.id;
    const currentStagedId = engine.snapshot().capture.staged!.id;
    engine.advance(2);

    expect(engine.snapshot().capture.previousStaged?.id).toBe(currentStagedId);
    expect(engine.snapshot().capture.previousStaged?.id).not.toBe(recoverableId);
  });

  it("records note intensity into time buckets instead of generating a carrier wave", async () => {
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    engine.advance(0.5);
    engine.dispatchMidi({ type: "note-on", channel: 0, note: 60, velocity: 127 });
    engine.advance(0.5);
    engine.dispatchMidi({ type: "note-off", channel: 0, note: 60 });
    engine.advance(1);

    const waveform = engine.snapshot().capture.staged?.waveform ?? [];
    expect(waveform.slice(0, 20)).toEqual(Array(20).fill(0));
    expect(waveform.slice(25, 48).every((sample) => sample === 1)).toBe(true);
    expect(waveform.slice(50).every((sample) => sample === 0)).toBe(true);
  });

  it("promotes a staged take and clears staging", async () => {
    const engine = new SimulatedHostEngine();
    await captureOneCycle(engine);
    const result = await engine.execute({ type: "promote-staged" });

    expect(result.accepted).toBe(true);
    expect(engine.snapshot().capture.staged).toBeNull();
    expect(engine.snapshot().promoted).toHaveLength(1);
  });

  it("preserves the staged audition state when promoting", async () => {
    const engine = new SimulatedHostEngine();
    await captureOneCycle(engine);
    await engine.execute({ type: "set-staged-audible", audible: false });
    await engine.execute({ type: "promote-staged" });

    expect(engine.snapshot().promoted[0]?.muted).toBe(true);
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

  it("keeps promoted takes within isolated melodic playback capacity", async () => {
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    for (let index = 0; index < 12; index += 1) {
      engine.advance(2);
      expect((await engine.execute({ type: "promote-staged" })).accepted).toBe(true);
    }
    engine.advance(2);

    const result = await engine.execute({ type: "promote-staged" });

    expect(result).toMatchObject({ accepted: false, error: "At most 12 promoted takes are supported" });
    expect(engine.snapshot().promoted).toHaveLength(12);
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
