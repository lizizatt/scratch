import { describe, expect, it, vi } from "vitest";
import { parseLoopSession, type EngineSnapshot } from "@alesis/protocol";
import { SimulatedHostEngine, type RuntimeSnapshot } from "./index.js";

function engineWithCatalogs(): SimulatedHostEngine {
  const engine = new SimulatedHostEngine({
    soundFonts: [{ id: "font", name: "Font" }],
    soundFontPresets: [{ id: "0:0", name: "Piano", bank: 0, program: 0 }],
    drumKits: [{ id: "kit", name: "Kit", bank: 128, program: 0 }],
  });
  engine.setSamplePage(0, 1, [{ id: "sample", name: "Sample", pad: 0 }, null, null, null, null, null, null, null]);
  engine.setSampleCatalog([{ id: "sample", name: "Sample" }]);
  engine.restorePadAssignments([{ mode: "drums", page: 0, pad: 0, action: { kind: "control", target: "transport", operation: "toggle" } }]);
  return engine;
}

function sessionFor(engine: SimulatedHostEngine) {
  const s = engine.snapshot();
  const { midiInputId: _midi, audioOutputId: _audio, ...settings } = s.settings;
  const take = { id: "imported", cycle: 7, level: 0.6, muted: false, waveform: [0.1, 0.8] };
  return parseLoopSession(JSON.stringify({
    format: "alesis-loop-session", version: 1, sourceOrigin: 0, loopStart: 0.25, overdub: true,
    settings: { ...settings, bpm: 120, loopMeasures: 1, countInEnabled: false },
    synth: { selectedId: "subtractive", parameterValues: s.synth.parameterValues, soundFont: null },
    drums: s.drums, arpeggiator: s.arpeggiator, percussion: null,
    monitorOnly: false, stagedAudible: true, quantization: "off",
    staged: { take, recording: [], rawRecording: [] }, previousStaged: null, promoted: [],
  }));
}

describe("detached runtime snapshots", () => {
  it("keeps public snapshots and nested metadata detached, including listener snapshots", async () => {
    const engine = engineWithCatalogs();
    engine.restoreLoopSession(sessionFor(engine), [{ id: "0:0", name: "Piano", bank: 0, program: 0 }], () => {});
    const before = engine.snapshot();
    const listener = vi.fn<(snapshot: EngineSnapshot) => void>();
    engine.subscribe(listener);
    const copy = listener.mock.calls[0]![0];
    copy.synth.instruments[0]!.controls[0]!.label = "tampered";
    copy.synth.parameterValues.cutoff = 1;
    copy.synth.soundFonts[0]!.name = "tampered";
    copy.synth.soundFontPresets[0]!.name = "tampered";
    copy.pads.drumKits[0]!.name = "tampered";
    copy.pads.samplePage[0]!.name = "tampered";
    copy.pads.sampleCatalog[0]!.name = "tampered";
    const action = copy.pads.assignments[0]!.action;
    if (action.kind === "control") action.operation = "off";
    copy.capture.staged!.waveform[0] = 1;
    expect(engine.snapshot()).toEqual(before);
    await engine.execute({ type: "set-synth-parameter", parameterId: "cutoff", value: 800 });
    expect(before.synth.parameterValues.cutoff).not.toBe(800);
    expect(listener.mock.calls.at(-1)![0].synth.parameterValues.cutoff).toBe(800);
  });

  it("projects current state without catalogs or waveforms and isolates every retained object", async () => {
    const engine = engineWithCatalogs();
    engine.restoreLoopSession(sessionFor(engine), [], () => {});
    await engine.execute({ type: "promote-staged" });
    engine.ensureOverdubStaged();
    const before = engine.snapshot();
    const runtime = engine.runtimeSnapshot();
    expect(before).toMatchObject(runtime);
    expect(Object.keys(runtime.synth).sort()).toEqual(["selectedId", "selectedSoundFontId", "selectedSoundFontPresetId"]);
    expect(Object.keys(runtime.pads).sort()).toEqual(["mode", "selectedDrumKitId"]);
    expect(runtime.capture).not.toHaveProperty("currentWaveform");
    expect(runtime.capture.staged).not.toHaveProperty("waveform");
    expect(runtime.promoted[0]).not.toHaveProperty("waveform");
    runtime.settings.bpm = 300;
    runtime.transport.progress = 0.9;
    runtime.arpeggiator.enabled = true;
    runtime.drums.enabled = true;
    runtime.synth.selectedId = "soundfont";
    runtime.pads.mode = "samples";
    runtime.capture.staged!.level = 0;
    runtime.promoted[0]!.muted = true;
    runtime.promoted.push({ id: "extra", cycle: 0, level: 0, muted: false });
    expect(engine.snapshot()).toEqual(before);
  });

  it("observes unpublished mutations and transport movement without relying on revision", async () => {
    const engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, loopMeasures: 1 } });
    await engine.execute({ type: "set-overdub", enabled: true });
    await engine.execute({ type: "play" });
    const before = engine.runtimeSnapshot();
    engine.markCaptureActivity();
    engine.ensureOverdubStaged();
    engine.setCaptureError("capacity");
    engine.advance(0.25);
    const after = engine.runtimeSnapshot();
    expect(after.revision).toBe(before.revision);
    expect(after.transport.progress).toBe(0.125);
    expect(after.capture).toMatchObject({ hasCurrentEvents: true, error: "capacity", staged: { cycle: 0 } });
    expect(before.capture).toMatchObject({ hasCurrentEvents: false, error: null, staged: null });
    expect(before.transport.progress).toBe(0);
    expect(engine.snapshot()).toMatchObject(after);
  });

  it("reads waveform feedback freshly through the public API at an unchanged revision", () => {
    const engine = new SimulatedHostEngine();
    engine.restoreLoopSession(sessionFor(engine), [], () => {});
    const before = engine.snapshot();
    const waveform = [0.2, 0.4];
    engine.setStagedWaveform("imported", waveform);
    waveform[0] = 1;
    const after = engine.snapshot();
    expect(after.revision).toBe(before.revision);
    expect(after.capture.staged!.waveform).toEqual([0.2, 0.4]);
    expect(before.capture.staged!.waveform).toEqual([0.1, 0.8]);
  });

  it("keeps old views stable through quantization, level, stop, clear and atomic import", async () => {
    const engine = new SimulatedHostEngine();
    const session = sessionFor(engine);
    engine.restoreLoopSession(session, [], () => {});
    const held = engine.runtimeSnapshot();
    const heldCopy = structuredClone(held);
    const observed: RuntimeSnapshot[] = [];
    engine.subscribeRuntime((s) => observed.push(s));
    await engine.execute({ type: "set-quantization", mode: "1/16" });
    expect(engine.runtimeSnapshot().capture.quantization).toBe("1/16");
    await engine.execute({ type: "promote-staged" });
    await engine.execute({ type: "set-take-level", takeId: "imported", level: 0.2 });
    expect(engine.runtimeSnapshot().promoted[0]!.level).toBe(0.2);
    await engine.execute({ type: "play" });
    engine.advance(0.3);
    await engine.execute({ type: "stop" });
    expect(engine.runtimeSnapshot().transport).toMatchObject({ state: "stopped", progress: 0 });
    await engine.execute({ type: "configure", settings: { bpm: 140 }, clearAudio: true });
    expect(engine.runtimeSnapshot()).toMatchObject({ settings: { bpm: 140 }, promoted: [], capture: { staged: null, loopStart: 0 } });
    let resourcesInstalled = false;
    const unsubscribe = engine.subscribeRuntime((s) => { if (s.capture.staged?.id === "imported") expect(resourcesInstalled).toBe(true); });
    engine.restoreLoopSession(session, [], () => { resourcesInstalled = true; });
    session.staged!.take.level = 0;
    expect(engine.runtimeSnapshot().capture.staged!.level).toBe(0.6);
    expect(engine.snapshot()).toMatchObject(engine.runtimeSnapshot());
    expect(observed.at(-1)).toEqual(engine.runtimeSnapshot());
    expect(held).toEqual(heldCopy);
    unsubscribe();
  });

  it("preserves mixed subscription order and each publication across synchronous reentry", async () => {
    const engine = new SimulatedHostEngine();
    const calls: string[] = [];
    let armed = false;
    let nested: Promise<unknown> | undefined;
    engine.subscribe((s) => {
      calls.push(`full-first:${s.revision}:${s.drums.enabled}`);
      if (armed && s.revision === 1) nested = engine.execute({ type: "configure-drums", settings: { enabled: true } });
    });
    engine.subscribeRuntime((s) => calls.push(`runtime:${s.revision}:${s.drums.enabled}`));
    engine.subscribe((s) => calls.push(`full-last:${s.revision}:${s.drums.enabled}`));
    calls.length = 0; armed = true;
    await engine.execute({ type: "configure", settings: { bpm: 120 } });
    await nested;
    expect(calls).toEqual([
      "full-first:1:false", "full-first:2:true", "runtime:2:true", "full-last:2:true", "runtime:1:false", "full-last:1:false",
    ]);
    expect(engine.runtimeSnapshot()).toMatchObject({ revision: 2, drums: { enabled: true } });
  });

  it("skips full cloning for runtime-only publication, preserving public subscriptions and disposal", async () => {
    const engine = new SimulatedHostEngine();
    const full = vi.spyOn(engine, "snapshot");
    const runtime = vi.fn<(s: RuntimeSnapshot) => void>();
    const unsubscribe = engine.subscribeRuntime(runtime);
    engine.dispatchMidi({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    expect(runtime).toHaveBeenCalledTimes(2);
    expect(full).not.toHaveBeenCalled();
    const publicListener = vi.fn();
    const unsubscribePublic = engine.subscribe(publicListener);
    full.mockClear();
    engine.dispatchMidi({ type: "note-off", channel: 0, note: 60 });
    expect(full).toHaveBeenCalledTimes(1);
    expect(publicListener).toHaveBeenCalledTimes(2);
    unsubscribePublic(); unsubscribe();
    full.mockClear();
    engine.dispatchMidi({ type: "pitch-bend", channel: 0, value: 0 });
    expect(full).not.toHaveBeenCalled();
    engine.subscribeRuntime(runtime);
    await engine.dispose();
    runtime.mockClear();
    engine.dispatchMidi({ type: "pitch-bend", channel: 0, value: 0 });
    expect(runtime).not.toHaveBeenCalled();
  });
});