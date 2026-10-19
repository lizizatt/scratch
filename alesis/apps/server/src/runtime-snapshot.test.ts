import { afterEach, describe, expect, it, vi } from "vitest";
import { SilentAudioOutput, type AudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { parseLoopSession, type EngineCommand } from "@alesis/protocol";
import { MidiLoopScheduler } from "./loop-playback.js";
import { TransportPlayback } from "./transport-playback.js";
import { PerformanceRouter } from "./performance-router.js";
import { executeLoopCommand } from "./loop-commands.js";
import { exportLoopSession } from "./loop-session.js";

afterEach(() => vi.useRealTimers());

async function rig(narrow: boolean) {
  let now = 0;
  const engine = new SimulatedHostEngine();
  await engine.execute({ type: "configure", settings: { bpm: 120, countInEnabled: false, loopMeasures: 1, metronomeEnabled: false } });
  const output: AudioOutput = new SilentAudioOutput();
  const delivered: MidiEvent[] = [];
  output.dispatchMidi = (event: MidiEvent) => { delivered.push(event); };
  const loops = new MidiLoopScheduler(output, { stagedWaveform: (id, waveform) => engine.setStagedWaveform(id, waveform) });
  const read = () => narrow ? engine.runtimeSnapshot() : engine.snapshot();
  const source = narrow ? engine : {
    runtimeSnapshot: () => engine.snapshot(),
    subscribeRuntime: engine.subscribe.bind(engine),
    advance: engine.advance.bind(engine),
  };
  const playback: TransportPlayback = new TransportPlayback(source, output, (event, boundary) => {
    now += 0.5;
    playback.advance();
    engine.markCaptureActivity();
    loops.record(event, read(), boundary);
  }, { now: () => now, setTimeout, clearTimeout }, loops);
  // Keep the production control-server subscriber's full-snapshot publication path.
  engine.subscribe(() => {});
  const router = new PerformanceRouter();
  const advance = (ms: number) => { now += ms; playback.advance(); };
  const input = (event: MidiEvent) => {
    playback.advance();
    engine.dispatchMidi(event);
    for (const routed of router.route(event)) playback.handle(routed);
  };
  const command = async (command: EngineCommand) => {
    const result = await executeLoopCommand(command, engine, loops, playback);
    expect(result.accepted, result.error).toBe(true);
  };
  const save = () => exportLoopSession({ engine, loops, percussionSoundFontId: null, inspectPresets: () => [], prepareAudio: async () => ({ commit() {}, async dispose() {} }) }).sessionJson!;
  return { engine, loops, playback, delivered, read, advance, input, command, save };
}

describe("runtime state in production capture and playback", () => {
  it("matches full detached reads through capture, quantization, replay, export, import and clear", async () => {
    vi.useFakeTimers();
    const run = async (narrow: boolean) => {
      const h = await rig(narrow);
      try {
        await h.command({ type: "set-overdub", enabled: true });
        await h.command({ type: "play" });
        h.advance(123);
        h.input({ type: "pitch-bend", channel: 2, value: 0.25 });
        h.input({ type: "note-on", channel: 2, note: 60, velocity: 96 });
        h.advance(151);
        h.input({ type: "control-change", channel: 2, controller: 64, value: 127 });
        h.input({ type: "note-off", channel: 2, note: 60 });
        h.advance(137);
        h.input({ type: "control-change", channel: 2, controller: 64, value: 0 });
        h.advance(1600);
        await h.command({ type: "set-quantization", mode: "1/16" });
        h.advance(150);
        await h.command({ type: "stop" });
        const sessionJson = h.save();
        expect(parseLoopSession(sessionJson).staged!.recording.length).toBeGreaterThan(0);
        const session = parseLoopSession(sessionJson);
        h.engine.restoreLoopSession(session, [], h.loops.prepareSessionRestore(session));
        expect(h.save()).toBe(sessionJson);
        await h.command({ type: "play" });
        for (let i = 0; i < 42; i++) h.advance(50);
        expect(h.delivered.some((event) => event.type === "note-on")).toBe(true);
        await h.command({ type: "stop" });
        await h.command({ type: "configure", settings: { bpm: 137 }, clearAudio: true });
        expect(h.loops.storageStats()).toEqual({ recordings: 0, rawRecordings: 0, channels: 0 });
        expect(h.read()).toMatchObject({ capture: { staged: null }, promoted: [], transport: { state: "stopped", progress: 0 } });
        return { sessionJson, delivered: h.delivered, final: h.engine.snapshot() };
      } finally { h.playback.dispose(); await h.engine.dispose(); }
    };
    expect(await run(true)).toEqual(await run(false));
  });

  it("captures fresh position after advance synchronously reconfigures timing and delivery advances again", async () => {
    vi.useFakeTimers();
    const h = await rig(true);
    try {
      await h.command({ type: "play" });
      const before = h.read();
      let armed = true;
      h.engine.subscribe((s) => {
        if (armed && s.transport.progress > 0) {
          armed = false;
          void h.engine.execute({ type: "configure", settings: { bpm: 240 } });
        }
      });
      const record = vi.spyOn(h.loops, "record");
      h.advance(250);
      h.input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
      const captured = record.mock.calls.at(-1)![1];
      expect(captured.settings.bpm).toBe(240);
      expect(captured.transport.progress).toBeCloseTo(0.2505, 10);
      expect(captured.capture.hasCurrentEvents).toBe(true);
      expect(before.transport.progress).toBe(0);
      expect(before.settings.bpm).toBe(120);
      expect(h.read()).toEqual(captured);
    } finally { h.playback.dispose(); await h.engine.dispose(); }
  });

  it("does not reuse a pending transaction snapshot after silent capture feedback", async () => {
    vi.useFakeTimers();
    const h = await rig(true);
    try {
      await h.command({ type: "play" });
      const seen = vi.spyOn(h.engine, "runtimeSnapshot");
      await h.playback.transaction(async () => {
        await h.engine.execute({ type: "set-overdub", enabled: true });
        // No subsequent publication or revision change: the transaction must read again.
        h.engine.ensureOverdubStaged();
        h.engine.markCaptureActivity();
        h.engine.setCaptureError("after-publication");
      });
      expect(seen.mock.results.at(-1)!.value).toMatchObject({ capture: { staged: { cycle: 0 }, hasCurrentEvents: true, error: "after-publication" } });
      const held = h.read();
      await h.command({ type: "stop" });
      expect(held.transport.state).toBe("playing");
      expect(h.read().transport.state).toBe("stopped");
    } finally { h.playback.dispose(); await h.engine.dispose(); }
  });
});