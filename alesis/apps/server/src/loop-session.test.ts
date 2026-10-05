import { describe, expect, it, vi } from "vitest";
import { SilentAudioOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { parseLoopSession, type LoopSession } from "@alesis/protocol";
import { MidiLoopScheduler, quantizeRecording } from "./loop-playback.js";
import { exportLoopSession, importLoopSession, prepareSessionAudio, type LoopSessionHost } from "./loop-session.js";

const preset = { id: "0:6", bank: 0, program: 6, name: "Test voice" };
const kit = { id: "drum:128:0", bank: 128, program: 0, name: "Standard" };
const events: MidiEvent[] = [
  { type: "note-on", channel: 0, note: 60, velocity: 90 },
  { type: "note-on", channel: 2, note: 64, velocity: 110 },
  { type: "control-change", channel: 0, controller: 64, value: 127 },
  { type: "pitch-bend", channel: 2, value: -0.75 },
  { type: "channel-pressure", channel: 2, value: 70 },
  { type: "note-off", channel: 0, note: 60 },
  { type: "note-off", channel: 2, note: 64 },
  { type: "control-change", channel: 0, controller: 64, value: 0 },
];

async function fixture() {
  const output = new SilentAudioOutput();
  const dispatch = vi.spyOn(output as AudioOutput, "dispatchMidi");
  const engine = new SimulatedHostEngine({ soundFonts: [{ id: "test-sf2", name: "Test" }], soundFontPresets: [preset], drumKits: [kit] });
  const loops = new MidiLoopScheduler(output);
  const commit = vi.fn();
  const dispose = vi.fn(async () => {});
  const prepareAudio = vi.fn(async () => ({ commit, dispose }));
  const host: LoopSessionHost = { engine, loops, percussionSoundFontId: "fluidr3-gm-sf2", inspectPresets: () => [preset], prepareAudio };
  await engine.execute({ type: "configure", settings: { bpm: 120, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false } });
  await engine.execute({ type: "set-quantization", mode: "1/4" });
  await engine.execute({ type: "play" });
  for (let cycle = 0; cycle < 4; cycle++) {
    engine.advance(0.1);
    for (const event of events) {
      loops.record(event, engine.snapshot());
      engine.dispatchMidi(event);
      engine.advance(0.03);
    }
    engine.advance(1.66);
    loops.update(engine.snapshot());
    if (cycle < 2) await engine.execute({ type: "promote-staged" });
  }
  const id = engine.snapshot().promoted[0]!.id;
  await engine.execute({ type: "set-take-muted", takeId: id, muted: true });
  await engine.execute({ type: "set-take-level", takeId: id, level: 0.31 });
  await engine.execute({ type: "set-staged-audible", audible: false });
  await engine.execute({ type: "set-monitor-only", enabled: true });
  await engine.execute({ type: "configure-arpeggiator", settings: { enabled: true, mode: "down", latch: true, swing: 0.2 } });
  await engine.execute({ type: "configure-drums", settings: { enabled: true, pattern: "breakbeat", volume: 0.42 } });
  // The partial cycle must not become a completed take in a saved session.
  loops.record({ type: "note-on", channel: 0, note: 99, velocity: 100 }, engine.snapshot());
  await engine.execute({ type: "stop" });
  loops.update(engine.snapshot());
  return { host, engine, loops, dispatch, commit, dispose, prepareAudio };
}

function withoutIds(session: LoopSession) {
  const copy = structuredClone(session);
  for (const entry of [copy.staged, copy.previousStaged, ...copy.promoted]) if (entry) entry.take.id = "ignored";
  return copy;
}

describe("editable loop sessions", () => {
  it.each(["legacy", "modern"] as const)("preserves exact %s staged timing on import, export and playback until quantization changes", async (representation) => {
    const { host, engine, loops, dispatch } = await fixture();
    const session = parseLoopSession(exportLoopSession(host).sessionJson!);
    session.monitorOnly = false;
    session.stagedAudible = true;
    for (const entry of session.promoted) entry.take.muted = true;
    const raw = [
      { position: 0.75, event: { type: "note-on" as const, channel: 0, note: 60, velocity: 100 } },
      { position: 0.9375, event: { type: "note-off" as const, channel: 0, note: 60 } },
    ];
    session.staged!.rawRecording = raw;
    session.staged!.recording = representation === "legacy"
      ? [{ position: 0, event: raw[1]!.event }, raw[0]!]
      : quantizeRecording(raw, "1/4", 4);
    const saved = structuredClone(session.staged!.recording);
    await importLoopSession(JSON.stringify(session), host);
    expect(withoutIds(parseLoopSession(exportLoopSession(host).sessionJson!))).toEqual(withoutIds(session));
    const id = engine.snapshot().capture.staged!.id;
    dispatch.mockClear();
    await engine.execute({ type: "play" });
    loops.update(engine.snapshot());
    engine.advance(1.5);
    loops.update(engine.snapshot());
    expect(loops.exportRecordings([id]).get(id)).toEqual(saved);
    expect(dispatch.mock.calls.map(([event]) => event.type)).toEqual(representation === "legacy" ? ["note-off", "note-on"] : ["note-on"]);
    await engine.execute({ type: "stop" });
    loops.update(engine.snapshot());
    // Re-loading an exported legacy session must still recognize the same representation.
    await importLoopSession(exportLoopSession(host).sessionJson!, host);
    await engine.execute({ type: "set-quantization", mode: "off" });
    const changed = parseLoopSession(exportLoopSession(host).sessionJson!);
    expect(changed.staged!.recording).toEqual(raw);
    expect(changed.previousStaged!.recording).toEqual(session.previousStaged!.recording);
    expect(changed.promoted.map(({ recording }) => recording)).toEqual(session.promoted.map(({ recording }) => recording));
    await engine.execute({ type: "set-quantization", mode: "1/4" });
    expect(parseLoopSession(exportLoopSession(host).sessionJson!).staged!.recording).toEqual(quantizeRecording(raw, "1/4", 4));
  });

  it.each(["position", "velocity", "missing", "extra", "raw"] as const)("rejects a near-legacy %s mismatch atomically", async (mutation) => {
    const { host, engine, loops, prepareAudio } = await fixture();
    const session = parseLoopSession(exportLoopSession(host).sessionJson!);
    const attack = { type: "note-on" as const, channel: 0, note: 60, velocity: 100 };
    const release = { type: "note-off" as const, channel: 0, note: 60 };
    session.staged!.rawRecording = [{ position: 0.75, event: attack }, { position: 0.9375, event: release }];
    session.staged!.recording = [{ position: 0, event: release }, { position: 0.75, event: { ...attack } }];
    if (mutation === "position") session.staged!.recording[0]!.position = 0.01;
    if (mutation === "velocity") (session.staged!.recording[1]!.event as typeof attack).velocity = 99;
    if (mutation === "missing") session.staged!.recording.shift();
    if (mutation === "extra") session.staged!.recording.push({ position: 1, event: release });
    if (mutation === "raw") session.staged!.rawRecording[0]!.event = { ...attack, note: 61 };
    const before = engine.snapshot();
    const recordings = loops.captureSessionTakes(before);
    await expect(importLoopSession(JSON.stringify(session), host)).rejects.toThrow("Staged MIDI does not match");
    expect(engine.snapshot()).toEqual(before);
    expect(loops.captureSessionTakes(before)).toEqual(recordings);
    expect(prepareAudio).not.toHaveBeenCalled();
  });

  it("recognizes legacy deduplication and same-bin gate expansion, not just wrapped releases", async () => {
    const { host } = await fixture();
    const session = parseLoopSession(exportLoopSession(host).sessionJson!);
    const attack = { type: "note-on" as const, channel: 0, note: 60, velocity: 100 };
    const release = { type: "note-off" as const, channel: 0, note: 60 };
    session.staged!.rawRecording = [
      { position: 0.13, event: { ...attack, velocity: 70 } }, { position: 0.14, event: release },
      { position: 0.2, event: attack }, { position: 0.65, event: release },
    ];
    session.staged!.recording = [
      { position: 0.25, event: release }, { position: 0.25, event: attack }, { position: 0.75, event: release },
    ];
    await expect(importLoopSession(JSON.stringify(session), host)).resolves.toMatchObject({ accepted: true });
    expect(parseLoopSession(exportLoopSession(host).sessionJson!).staged!.recording).toEqual(session.staged!.recording);
    session.staged!.rawRecording = [{ position: 0.8, event: attack }, { position: 0.81, event: release }];
    session.staged!.recording = [{ position: 0.75, event: attack }, { position: 0.875, event: release }];
    await expect(importLoopSession(JSON.stringify(session), host)).resolves.toMatchObject({ accepted: true });
  });

  it("roundtrips all completed slots, expression, settings, mute/levels, and reversible raw staging", async () => {
    const { host, engine, loops, commit } = await fixture();
    const json = exportLoopSession(host).sessionJson!;
    const session = parseLoopSession(json);
    expect(session.promoted).toHaveLength(2);
    expect(session.staged).not.toBeNull();
    expect(session.previousStaged).not.toBeNull();
    expect(session.promoted[0]?.take).toMatchObject({ muted: true, level: 0.31 });
    expect(session.staged!.rawRecording.map(({ event }) => event)).toEqual([
      events[0], { type: "pitch-bend", channel: 2, value: -0.75 }, ...events.slice(1),
    ]);
    // Channel 2's held bend starts at its first attack, not before channel 0's.
    expect(session.staged!.rawRecording[1]!.position).toBeCloseTo(0.065, 10);
    expect(session.staged!.recording).not.toEqual(session.staged!.rawRecording);
    expect(json).not.toMatch(/midiInputId|audioOutputId|99|path/);
    const devices = engine.snapshot().settings;
    await engine.execute({ type: "delete-take", takeId: session.promoted[0]!.take.id });
    expect(engine.snapshot().canUndoDelete).toBe(true);
    // A subscriber must never see imported metadata without its matching MIDI.
    const unsubscribe = engine.subscribe((snapshot) => {
      const ids = snapshot.promoted.filter(({ id }) => id.startsWith("session-")).map(({ id }) => id);
      expect(loops.exportRecordings(ids).size).toBe(ids.length);
    });
    expect((await importLoopSession(json, host)).accepted).toBe(true);
    unsubscribe();
    expect(commit).toHaveBeenCalledOnce();
    expect(engine.snapshot()).toMatchObject({ transport: { state: "stopped", cycle: 0, progress: 0 }, canUndoDelete: false, settings: { midiInputId: devices.midiInputId, audioOutputId: devices.audioOutputId } });
    const restored = parseLoopSession(exportLoopSession(host).sessionJson!);
    expect(withoutIds(restored)).toEqual(withoutIds(session));
    expect(restored.promoted[0]!.take.id).not.toBe(session.promoted[0]!.take.id);
    await engine.execute({ type: "set-quantization", mode: "off" });
    const rawAgain = parseLoopSession(exportLoopSession(host).sessionJson!);
    expect(rawAgain.staged!.recording).toEqual(session.staged!.rawRecording);
    expect(rawAgain.promoted.map(({ recording }) => recording)).toEqual(session.promoted.map(({ recording }) => recording));
    expect(rawAgain.previousStaged!.recording).toEqual(session.previousStaged!.recording);
    await engine.execute({ type: "play" });
    loops.update(engine.snapshot());
    engine.advance(2);
    loops.update(engine.snapshot());
    const allIds = [engine.snapshot().capture.staged!.id, engine.snapshot().capture.previousStaged!.id, ...engine.snapshot().promoted.map(({ id }) => id)];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(loops.exportRecordings(allIds).size).toBe(allIds.length);
  });

  it("replays imported events through the scheduler, applying mute and levels", async () => {
    const { host, engine, loops, dispatch } = await fixture();
    const session = parseLoopSession(exportLoopSession(host).sessionJson!);
    session.monitorOnly = false;
    session.stagedAudible = false;
    session.promoted[1]!.take.level = 0.5;
    await importLoopSession(JSON.stringify(session), host);
    dispatch.mockClear();
    await engine.execute({ type: "play" });
    loops.update(engine.snapshot());
    engine.advance(0.5);
    loops.update(engine.snapshot());
    expect(dispatch).toHaveBeenCalledWith({ type: "note-on", channel: 1, note: 60, velocity: 45 });
    expect(dispatch).toHaveBeenCalledWith({ type: "note-on", channel: 1, note: 64, velocity: 55 });
    expect(dispatch).toHaveBeenCalledWith({ type: "channel-pressure", channel: 1, value: 70 });
    expect(dispatch).toHaveBeenCalledWith({ type: "pitch-bend", channel: 1, value: -0.75 });
    expect(dispatch.mock.calls.filter(([event]) => event.type === "note-on")).toHaveLength(2);
  });

  it.each(["font", "preset", "kit", "parameter", "raw", "version", "json"])("rejects invalid %s without changing any state or preparing audio", async (kind) => {
    const { host, engine, loops, prepareAudio } = await fixture();
    const session = parseLoopSession(exportLoopSession(host).sessionJson!);
    const before = engine.snapshot();
    const recordings = loops.captureSessionTakes(before);
    if (kind === "font") session.synth.soundFont!.id = "missing";
    if (kind === "preset") session.synth.soundFont!.preset.program = 80;
    if (kind === "kit") session.percussion!.kit.program = 100;
    if (kind === "parameter") session.synth.parameterValues.cutoff = 100_000;
    if (kind === "raw") session.staged!.rawRecording = [];
    const json = kind === "json" ? "{" : kind === "version" ? JSON.stringify({ ...session, version: 42 }) : JSON.stringify(session);
    await expect(importLoopSession(json, host)).rejects.toThrow();
    expect(engine.snapshot()).toEqual(before);
    expect(loops.captureSessionTakes(before)).toEqual(recordings);
    expect(prepareAudio).not.toHaveBeenCalled();
  });

  it("leaves settings, recordings and takes intact when audio preparation fails", async () => {
    const { host, engine, loops, prepareAudio, commit } = await fixture();
    const json = exportLoopSession(host).sessionJson!;
    const before = engine.snapshot();
    const recordings = loops.captureSessionTakes(before);
    prepareAudio.mockRejectedValueOnce(new Error("Font failed to load"));
    await expect(importLoopSession(json, host)).rejects.toThrow("Font failed");
    expect(engine.snapshot()).toEqual(before);
    expect(loops.captureSessionTakes(before)).toEqual(recordings);
    expect(commit).not.toHaveBeenCalled();
  });

  it("guards stopped transport, blocks raw engine commands, and rejects missing recordings", async () => {
    const { host, engine, loops } = await fixture();
    const json = exportLoopSession(host).sessionJson!;
    expect((await engine.execute({ type: "import-loop-session", sessionJson: json })).accepted).toBe(false);
    await engine.execute({ type: "play" });
    expect(() => exportLoopSession(host)).toThrow("Stop transport");
    await expect(importLoopSession(json, host)).rejects.toThrow("Stop transport");
    await engine.execute({ type: "stop" });
    loops.clearRecordings();
    expect(() => exportLoopSession(host)).toThrow("Missing");
  });

  it("disposes prepared audio if transport changed outside orchestration", async () => {
    const { host, engine, prepareAudio, dispose, commit } = await fixture();
    const json = exportLoopSession(host).sessionJson!;
    prepareAudio.mockImplementationOnce(async () => {
      await engine.execute({ type: "play" });
      return { dispose, commit };
    });
    await expect(importLoopSession(json, host)).rejects.toThrow("Stop transport");
    expect(dispose).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("prepares every audible setting on an isolated renderer, and closes failures without swapping", async () => {
    const { host } = await fixture();
    const session = parseLoopSession(exportLoopSession(host).sessionJson!);
    session.synth.selectedId = "soundfont";
    session.synth.parameterValues = { gain: 0.3 };
    const output = new SilentAudioOutput();
    const start = vi.spyOn(output, "start");
    const synth = vi.spyOn(output, "selectSynth");
    const parameter = vi.spyOn(output, "setSynthParameter");
    const selection = vi.spyOn(output, "selectSoundFontPreset");
    const drum = vi.spyOn(output, "selectDrumKit");
    const close = vi.spyOn(output, "close");
    const swap = vi.fn();
    const prepared = await prepareSessionAudio(session, () => output, swap);
    expect(start).toHaveBeenCalledOnce();
    expect(synth).toHaveBeenCalledWith("soundfont");
    expect(parameter).toHaveBeenCalledWith("soundfont", "gain", 0.3);
    expect(selection).toHaveBeenCalledWith(0, 6);
    expect(drum).toHaveBeenCalledWith(128, 0);
    expect(swap).not.toHaveBeenCalled();
    prepared.commit();
    expect(swap).toHaveBeenCalledWith(output);
    swap.mockClear();
    start.mockRejectedValueOnce(new Error("renderer load failed"));
    await expect(prepareSessionAudio(session, () => output, swap)).rejects.toThrow("renderer load failed");
    expect(close).toHaveBeenCalledOnce();
    expect(swap).not.toHaveBeenCalled();
  });
});
