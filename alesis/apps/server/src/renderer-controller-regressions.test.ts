import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FluidSynthOutput, NeonPressureOutput, NeonPressureSynth, SilentAudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { MidiLoopScheduler } from "./loop-playback.js";
import { PerformanceRouter } from "./performance-router.js";
import { createRendererControllerRestorer, panicRendererInput } from "./renderer-controllers.js";
import { DeviceHotplugCoordinator } from "./hotplug.js";

// Observe only children created by this test. They are real native renderers on
// the explicit null sink; never discover, attach to, or signal a running host.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
afterEach(() => {
  const children = vi.mocked(spawn).mock.results
    .filter(({ type }) => type === "return")
    .map(({ value }) => value as ChildProcessWithoutNullStreams);
  vi.restoreAllMocks();
  vi.mocked(spawn).mockClear();
  expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
});

async function nativeHost() {
  const commands: string[] = [];
  let resetCompleted = () => {};
  const audio = new FluidSynthOutput({
    device: { id: "controller-test-null", name: "Offline null sink", pcm: "null" },
    soundFontPath: process.env.ALESIS_TEST_SOUNDFONT ?? join(homedir(), "Downloads/STH.sf2"),
    commandObserver: (command) => commands.push(command),
    controllerResetObserver: () => { restore(); resetCompleted(); },
  });
  const engine = new SimulatedHostEngine();
  const loops = new MidiLoopScheduler(audio);
  const router = new PerformanceRouter();
  const restore = createRendererControllerRestorer(() => true, () => loops);
  const input = (event: MidiEvent) => {
    engine.dispatchMidi(event);
    for (const routed of router.route(event)) {
      engine.markCaptureActivity();
      loops.record(routed, engine.snapshot());
      audio.dispatchMidi(routed);
    }
  };
  const close = async () => { await audio.close(); await engine.dispose(); };
  try {
    await audio.start();
    await engine.execute({ type: "configure", settings: { bpm: 120, loopMeasures: 1, countInEnabled: false } });
  } catch (error) {
    await close();
    throw error;
  }
  return { audio, engine, loops, router, input, commands, close,
    nextReset: () => new Promise<void>((resolve) => { resetCompleted = resolve; }),
  };
}

describe("renderer controller continuity (offline native renderer)", () => {
  it("keeps a stopped held pedal consistent between live notes and capture after a font switch", async () => {
    const original = process.env.ALESIS_TEST_SOUNDFONT ?? join(homedir(), "Downloads/STH.sf2");
    const replacement = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
    expect(existsSync(original) && existsSync(replacement)).toBe(true);
    const commands: string[] = [];
    const audio: FluidSynthOutput = new FluidSynthOutput({
      device: { id: "controller-test-null", name: "Offline null sink", pcm: "null" },
      soundFontPath: original,
      commandObserver: (command) => commands.push(command),
      controllerResetObserver: createRendererControllerRestorer(() => true, () => loops),
    });
    const engine = new SimulatedHostEngine();
    const loops = new MidiLoopScheduler(audio);
    const router = new PerformanceRouter();
    const input = (event: MidiEvent) => {
      engine.dispatchMidi(event);
      for (const routed of router.route(event)) {
        engine.markCaptureActivity();
        loops.record(routed, engine.snapshot());
        audio.dispatchMidi(routed);
      }
    };
    try {
      await audio.start();
      await engine.execute({ type: "configure", settings: { bpm: 120, loopMeasures: 1, countInEnabled: false } });
      input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      await audio.loadSoundFont(replacement);
      await engine.execute({ type: "play" });
      input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      const livePedal = commands.filter((command) => command.startsWith("cc 0 64 ")).at(-1);
      engine.advance(0.1);
      input({ type: "note-off", channel: 0, note: 60 });
      engine.advance(1.9);
      loops.update(engine.snapshot());
      const replayPedal = commands.filter((command) => command.startsWith("cc 1 64 ")).at(-1);
      expect(replayPedal?.split(" ").at(-1)).toBe(livePedal?.split(" ").at(-1));
      expect(livePedal).toBe("cc 0 64 127");
    } finally {
      await audio.close();
      await engine.dispose();
    }
  }, 20_000);

  it("reapplies pedal and bend to both synths, including a newly routed channel", async () => {
    const neonInput = vi.spyOn(NeonPressureSynth.prototype, "dispatchMidi");
    const h = await nativeHost();
    try {
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      h.input({ type: "pitch-bend", channel: 0, value: -0.5 });
      await h.audio.selectSynth("subtractive");
      expect(neonInput.mock.calls.map(([event]) => event)).toEqual([
        { type: "control-change", channel: 0, controller: 64, value: 127 },
        { type: "pitch-bend", channel: 0, value: -0.5 },
      ]);
      await h.engine.execute({ type: "play" });
      h.input({ type: "note-on", channel: 2, note: 60, velocity: 100 });
      expect(neonInput.mock.calls.slice(-3).map(([event]) => event)).toEqual([
        { type: "control-change", channel: 2, controller: 64, value: 127 },
        { type: "pitch-bend", channel: 2, value: -0.5 },
        { type: "note-on", channel: 2, note: 60, velocity: 100 },
      ]);
      await h.audio.selectSynth("soundfont");
      for (const channel of [0, 2]) {
        expect(h.commands.filter((command) => command.startsWith(`cc ${channel} 64 `)).at(-1)).toBe(`cc ${channel} 64 127`);
        expect(h.commands.filter((command) => command.startsWith(`pitch_bend ${channel} `)).at(-1)).toBe(`pitch_bend ${channel} 4096`);
      }
      h.input({ type: "control-change", channel: 0, controller: 64, value: 0 });
      h.input({ type: "pitch-bend", channel: 0, value: 0 });
      for (const channel of [0, 2]) {
        expect(h.commands).toContain(`cc ${channel} 64 0`);
        expect(h.commands).toContain(`pitch_bend ${channel} 8192`);
      }
    } finally { await h.close(); }
  }, 20_000);

  it("restores held controllers after a synth switch fails after resetting FluidSynth", async () => {
    const h = await nativeHost();
    try {
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      vi.spyOn(NeonPressureOutput.prototype, "start").mockRejectedValueOnce(new Error("candidate failed"));
      h.commands.length = 0;
      await expect(h.audio.selectSynth("subtractive")).rejects.toThrow("candidate failed");
      expect(h.commands).toEqual(["reset", "cc 0 64 127"]);
    } finally { await h.close(); }
  }, 20_000);

  it("preserves completed takes and in-progress capture across a SoundFont reset without recording the reapply", async () => {
    const h = await nativeHost();
    try {
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      await h.engine.execute({ type: "play" });
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      h.engine.advance(0.1);
      h.input({ type: "note-off", channel: 0, note: 60 });
      h.engine.advance(1.9);
      h.loops.update(h.engine.snapshot());
      const previous = h.engine.snapshot().capture.staged!;
      const saved = h.loops.exportRecordings([previous.id]);
      h.input({ type: "note-on", channel: 0, note: 64, velocity: 100 });
      await h.audio.loadSoundFont("/usr/share/sounds/sf2/FluidR3_GM.sf2");
      h.engine.advance(0.1);
      h.input({ type: "note-off", channel: 0, note: 64 });
      h.engine.advance(1.9);
      h.loops.update(h.engine.snapshot());
      expect(h.loops.exportRecordings([previous.id])).toEqual(saved);
      const recording = h.loops.exportRecordings([h.engine.snapshot().capture.staged!.id]).values().next().value!;
      expect(recording.map(({ event }) => event)).toEqual([
        { type: "control-change", channel: 0, controller: 64, value: 127 },
        { type: "note-on", channel: 0, note: 64, velocity: 100 },
        { type: "note-off", channel: 0, note: 64 },
      ]);
    } finally { await h.close(); }
  }, 20_000);

  it.each(["exit", "stall"] as const)("reapplies current delivered state after renderer %s recovery", async (failure) => {
    const h = await nativeHost();
    try {
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      h.input({ type: "pitch-bend", channel: 0, value: 0.5 });
      const calls = vi.mocked(spawn);
      const childIndex = calls.mock.calls.findIndex(([command]) => command === "fluidsynth");
      expect(childIndex).toBeGreaterThanOrEqual(0);
      const child = calls.mock.results[childIndex]!.value as ChildProcessWithoutNullStreams;
      const reset = h.nextReset();
      h.commands.length = 0;
      if (failure === "exit") expect(child.kill("SIGKILL")).toBe(true);
      else child.stderr.emit("data", Buffer.from("fluidsynth: warning: Ringbuffer full, try increasing synth.polyphony!"));
      // Controls may change while the replacement is launching. Restore current,
      // not a pre-recovery snapshot, and do not add synthetic capture events.
      h.input({ type: "pitch-bend", channel: 0, value: -0.5 });
      await reset;
      expect(h.commands.filter((command) => command.startsWith("cc 0 64 ")).at(-1)).toBe("cc 0 64 127");
      expect(h.commands.filter((command) => command.startsWith("pitch_bend 0 ")).at(-1)).toBe("pitch_bend 0 4096");
      await h.engine.execute({ type: "play" });
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      h.engine.advance(0.1);
      h.input({ type: "note-off", channel: 0, note: 60 });
      h.engine.advance(1.9);
      h.loops.update(h.engine.snapshot());
      const recording = h.loops.exportRecordings([h.engine.snapshot().capture.staged!.id]).values().next().value!;
      expect(recording.map(({ event }) => event)).toEqual([
        { type: "control-change", channel: 0, controller: 64, value: 127 },
        { type: "pitch-bend", channel: 0, value: -0.5 },
        { type: "note-on", channel: 0, note: 60, velocity: 100 },
        { type: "note-off", channel: 0, note: 60 },
      ]);
    } finally { await h.close(); }
  }, 20_000);

  it("does not reapply on no-op selections, rejected paths, explicit panic, or close", async () => {
    const h = await nativeHost();
    try {
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      h.commands.length = 0;
      await h.audio.loadSoundFont(process.env.ALESIS_TEST_SOUNDFONT ?? join(homedir(), "Downloads/STH.sf2"));
      await h.audio.selectSynth("soundfont");
      await expect(h.audio.loadSoundFont("/alesis-test-missing-font.sf2")).rejects.toThrow("SoundFont not found");
      await expect(h.audio.selectSynth("invalid")).rejects.toThrow("Unknown synth");
      expect(h.commands).toEqual([]);
      h.audio.panic();
      expect(h.commands).not.toContain("cc 0 64 127");
      h.commands.length = 0;
      await h.audio.close();
      expect(h.commands).not.toContain("cc 0 64 127");
    } finally { await h.close(); }
  }, 20_000);

  it("does not leak input controls from the current renderer into prepared or retired outputs", () => {
    const first = new SilentAudioOutput();
    const candidate = new SilentAudioOutput();
    let current = first;
    const dispatch = vi.spyOn(first, "dispatchMidi");
    const loops = new MidiLoopScheduler(first);
    const engine = new SimulatedHostEngine();
    loops.record({ type: "control-change", channel: 0, controller: 64, value: 127 }, engine.snapshot());
    const restoreFirst = createRendererControllerRestorer(() => current === first, () => loops);
    const restoreCandidate = createRendererControllerRestorer(() => current === candidate, () => loops);
    restoreCandidate();
    expect(dispatch).not.toHaveBeenCalled();
    restoreFirst();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "control-change", channel: 0, controller: 64, value: 127 });
    dispatch.mockClear();
    current = candidate;
    restoreFirst();
    expect(dispatch).not.toHaveBeenCalled();
    void engine.dispose();
  });

  it("finalizes a completed take before host panic releases and discards input state", async () => {
    const output = new SilentAudioOutput();
    const engine = new SimulatedHostEngine();
    const loops = new MidiLoopScheduler(output);
    try {
      await engine.execute({ type: "configure", settings: { bpm: 120, loopMeasures: 1, countInEnabled: false } });
      await engine.execute({ type: "play" });
      engine.markCaptureActivity();
      loops.record({ type: "pitch-bend", channel: 0, value: 0.5 }, engine.snapshot());
      loops.record({ type: "note-on", channel: 0, note: 60, velocity: 100 }, engine.snapshot());
      engine.advance(2);
      const completed = engine.snapshot().capture.staged!;
      const release = vi.fn(() => {
        // Same as a panic with no active arp step: no release event forces a
        // scheduler update. The completed cycle must already be retained.
        expect(loops.exportRecordings([completed.id]).get(completed.id)).toEqual([
          { position: 0, event: { type: "pitch-bend", channel: 0, value: 0.5 } },
          { position: 0, event: { type: "note-on", channel: 0, note: 60, velocity: 100 } },
          { position: 1, event: { type: "note-off", channel: 0, note: 60 } },
        ]);
      });
      panicRendererInput(engine.snapshot(), loops, release, output);
      expect(release).toHaveBeenCalledOnce();
      expect(loops.hasCurrentRecording()).toBe(false);
      const dispatch = vi.spyOn(output, "dispatchMidi");
      loops.reapplyInputControllers();
      expect(dispatch).not.toHaveBeenCalled();
      expect(loops.exportRecordings([completed.id]).has(completed.id)).toBe(true);
    } finally { await engine.dispose(); }
  });

  it("keeps the hotplug panic policy: reconnect never resurrects pre-disconnect held controllers", async () => {
    const h = await nativeHost();
    const hotplug = new DeviceHotplugCoordinator({ audio: true, midi: true }, {
      panic: () => panicRendererInput(h.engine.snapshot(), h.loops, () => h.router.panic(), h.audio),
      stopTransport: async () => { await h.engine.execute({ type: "stop" }); },
      disconnectAudio: () => h.audio.close(),
      reconnectAudio: async () => { await h.audio.start(); return true; },
      disconnectMidi: async () => {}, reconnectMidi: async () => true, setReady: () => {},
    });
    try {
      h.input({ type: "control-change", channel: 0, controller: 64, value: 127 });
      h.input({ type: "pitch-bend", channel: 0, value: 0.5 });
      await hotplug.reconcile({ audio: false, midi: true });
      h.commands.length = 0;
      await hotplug.reconcile({ audio: true, midi: true });
      await h.engine.execute({ type: "play" });
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      h.engine.advance(0.1);
      h.input({ type: "note-off", channel: 0, note: 60 });
      h.engine.advance(1.9);
      h.loops.update(h.engine.snapshot());
      expect(h.commands).not.toContain("cc 0 64 127");
      expect(h.commands).not.toContain("pitch_bend 0 12288");
      const recording = h.loops.exportRecordings([h.engine.snapshot().capture.staged!.id]).values().next().value!;
      expect(recording.map(({ event }) => event.type)).toEqual(["note-on", "note-off"]);
    } finally { await h.close(); }
  }, 20_000);
});
