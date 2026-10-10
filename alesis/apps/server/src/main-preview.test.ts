import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { SilentAudioOutput, SimulatedLoopOutput, type AudioOutput } from "@alesis/audio";
import { SoftwareVortex, type MidiInputEvent } from "@alesis/midi";
import { SimulatedHostEngine } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import type { ControlServer } from "./control-server.js";
import type { LoopExports } from "./loop-export.js";
import type { DeviceHotplugCoordinator } from "./hotplug.js";
import { SamplePadService } from "./sample-pads.js";

const host = vi.hoisted(() => ({} as { engine: SimulatedHostEngine; server: ControlServer; exports: LoopExports; hotplug: DeviceHotplugCoordinator }));
vi.mock("./control-server.js", async (original) => {
  const actual = await original<typeof import("./control-server.js")>();
  return { ...actual, createControlServer: async (...args: Parameters<typeof actual.createControlServer>) => {
    host.engine = args[0] as SimulatedHostEngine;
    host.exports = args[6] as LoopExports;
    return host.server = await actual.createControlServer(...args);
  } };
});
vi.mock("./hotplug.js", async (original) => {
  const actual = await original<typeof import("./hotplug.js")>();
  return { ...actual, DeviceHotplugCoordinator: class extends actual.DeviceHotplugCoordinator {
    constructor(...args: ConstructorParameters<typeof actual.DeviceHotplugCoordinator>) { super(...args); host.hotplug = this; }
  } };
});

it("production host suppresses raw MIDI, drum/sample pads, arp and capture through preview and never resumes held input after cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "alesis-main-preview-"));
  for (const [key, value] of Object.entries({ PORT: "0", HOST: "127.0.0.1", AUDIO_MODE: "simulated", MIDI_MODE: "software", SOFTWARE_VORTEX_DEMO: "0", SAMPLE_LIBRARY_DIR: root, ALESIS_SETTINGS_PATH: join(root, "settings.json"), ALESIS_EXPORT_DIR: join(root, "exports") })) vi.stubEnv(key, value);
  const oldInterrupt = new Set(process.listeners("SIGINT"));
  const oldTerminate = new Set(process.listeners("SIGTERM"));
  const dispose = vi.spyOn(SimulatedHostEngine.prototype, "dispose");
  const subscribe = SoftwareVortex.prototype.subscribe;
  let input!: (event: MidiInputEvent) => void;
  vi.spyOn(SoftwareVortex.prototype, "subscribe").mockImplementation(function (this: SoftwareVortex, listener) { input = listener; return subscribe.call(this, listener); });
  const audio = vi.spyOn(SilentAudioOutput.prototype as AudioOutput, "dispatchMidi");
  const drums = vi.spyOn(SilentAudioOutput.prototype, "playDrum");
  const click = vi.spyOn(SilentAudioOutput.prototype, "playMetronome");
  const samples = vi.spyOn(SamplePadService.prototype, "trigger");
  let outputError!: (message: string) => void;
  const start = SimulatedLoopOutput.prototype.start;
  vi.spyOn(SimulatedLoopOutput.prototype, "start").mockImplementation(function (this: SimulatedLoopOutput, pcm, encoded, report) { outputError = report; return start.call(this, pcm, encoded, report); });
  const command = async (command: EngineCommand) => {
    const result = await host.server.submit(command);
    expect(result.accepted, result.error).toBe(true);
    return result;
  };
  try {
    await import("./main.js");
    await command({ type: "configure", settings: { bpm: 240, loopMeasures: 1, countInEnabled: false, metronomeEnabled: true }, clearAudio: true });
    await command({ type: "select-synth", synthId: "subtractive" });
    await command({ type: "play" });
    input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
    await vi.waitFor(() => expect(host.engine.snapshot().capture.staged).not.toBeNull(), { timeout: 2500 });
    input({ type: "note-off", channel: 0, note: 60 });
    await command({ type: "stop" });
    await command({ type: "configure-arpeggiator", settings: { enabled: true, latch: true } });
    await command({ type: "configure-drums", settings: { enabled: true } });
    for (const cancel of ["stop", "disconnect", "error", "midi", "audio"] as const) {
      const mode = cancel === "stop" || cancel === "midi" ? "drums" : "samples";
      await command({ type: "set-pad-mode", mode });
      // A latched stopped arp is audible before preview and must not return afterward.
      audio.mockClear();
      input({ type: "note-on", channel: 0, note: 67, velocity: 100 });
      await vi.waitFor(() => expect(audio.mock.calls.some(([event]) => event.type === "note-on")).toBe(true));
      const artifactId = randomUUID();
      await command({ type: "prepare-loop-export", artifactId, target: "sample", startBeat: 0 });
      const session = (await command({ type: "export-loop-session" })).sessionJson;
      await command({ type: "preview-loop-export", artifactId, enabled: true });
      const midiCount = host.engine.snapshot().engine.midiEventsReceived;
      audio.mockClear(); drums.mockClear(); click.mockClear(); samples.mockClear();
      for (const event of [
        { type: "note-on", channel: 0, note: 72, velocity: 100 },
        { type: "note-off", channel: 0, note: 72 },
        { type: "control-change", channel: 0, controller: 64, value: 127 },
        { type: "pitch-bend", channel: 0, value: 0.5 },
        { type: "note-on", channel: 9, note: 36, velocity: 100 },
        { type: "note-off", channel: 9, note: 36 },
        { type: "program-change", channel: 0, program: 1 },
      ] satisfies MidiInputEvent[]) input(event);
      for (const denied of [{ type: "play" }, { type: "trigger-sample-pad", pad: 0, velocity: 127 }, { type: "configure-drums", settings: { enabled: false } }] satisfies EngineCommand[]) {
        expect((await host.server.submit(denied)).accepted).toBe(false);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(audio).not.toHaveBeenCalled(); expect(drums).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled(); expect(samples).not.toHaveBeenCalled();
      expect(host.engine.snapshot().engine.midiEventsReceived).toBe(midiCount);
      if (cancel === "stop") await command({ type: "stop" });
      else if (cancel === "disconnect") await host.exports.disconnect("host");
      else if (cancel === "error") outputError("simulated output failure");
      else await host.hotplug.reconcile({ audio: cancel !== "audio", midi: cancel !== "midi" });
      await vi.waitFor(() => expect(host.exports.blocksPerformance()).toBe(false));
      await vi.waitFor(() => expect(host.exports.status().artifactId).toBeNull());
      audio.mockClear(); drums.mockClear(); click.mockClear();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(audio.mock.calls.filter(([event]) => event.type === "note-on")).toHaveLength(0);
      expect(drums).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
      expect(host.engine.snapshot().transport.state).toBe("stopped");
      expect((await command({ type: "export-loop-session" })).sessionJson).toBe(session);
    }
  } finally {
    const shutdown = process.listeners("SIGTERM").find((listener) => !oldTerminate.has(listener));
    if (shutdown) { shutdown("SIGTERM"); await vi.waitFor(() => expect(dispose).toHaveBeenCalled(), { timeout: 5000 }); }
    for (const listener of process.listeners("SIGTERM")) if (!oldTerminate.has(listener)) process.removeListener("SIGTERM", listener);
    for (const listener of process.listeners("SIGINT")) if (!oldInterrupt.has(listener)) process.removeListener("SIGINT", listener);
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
