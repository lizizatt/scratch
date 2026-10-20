import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { SilentAudioOutput } from "@alesis/audio";
import { SoftwareVortex, type MidiInputEvent } from "@alesis/midi";
import { SimulatedHostEngine } from "@alesis/engine";
import type { EngineCommand } from "@alesis/protocol";
import type { ControlServer } from "./control-server.js";

const host = vi.hoisted(() => ({} as { engine: SimulatedHostEngine; server: ControlServer }));
vi.mock("./control-server.js", async (original) => {
  const actual = await original<typeof import("./control-server.js")>();
  return { ...actual, createControlServer: async (...args: Parameters<typeof actual.createControlServer>) => {
    host.engine = args[0] as SimulatedHostEngine;
    return host.server = await actual.createControlServer(...args);
  } };
});

let root: string;
let oldInterrupt: Set<(...args: any[]) => void>;
let oldTerminate: Set<(...args: any[]) => void>;
let disposed = false;
let input!: (event: MidiInputEvent) => void;
const pinned: Array<[number, number, number]> = [];
const global: Array<[number, number]> = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "alesis-main-voices-"));
  for (const [key, value] of Object.entries({ PORT: "0", HOST: "127.0.0.1", AUDIO_MODE: "simulated", MIDI_MODE: "software", SOFTWARE_VORTEX_DEMO: "0", SAMPLE_LIBRARY_DIR: join(root, "samples"), ALESIS_SETTINGS_PATH: join(root, "settings.json"), ALESIS_EXPORT_DIR: join(root, "exports") })) vi.stubEnv(key, value);
  oldInterrupt = new Set(process.listeners("SIGINT"));
  oldTerminate = new Set(process.listeners("SIGTERM"));
  const dispose = SimulatedHostEngine.prototype.dispose;
  vi.spyOn(SimulatedHostEngine.prototype, "dispose").mockImplementation(function (this: SimulatedHostEngine) { disposed = true; return dispose.call(this); });
  const subscribe = SoftwareVortex.prototype.subscribe;
  vi.spyOn(SoftwareVortex.prototype, "subscribe").mockImplementation(function (this: SoftwareVortex, listener) { input = listener; return subscribe.call(this, listener); });
  vi.spyOn(SilentAudioOutput.prototype, "setChannelVoice").mockImplementation(((channel: number, bank: number, program: number) => { pinned.push([channel, bank, program]); }) as never);
  vi.spyOn(SilentAudioOutput.prototype, "selectSoundFontPreset").mockImplementation(((bank: number, program: number) => { global.push([bank, program]); }) as never);
  await import("./main.js");
});

afterAll(async () => {
  try {
    const shutdown = process.listeners("SIGTERM").find((listener) => !oldTerminate.has(listener));
    if (shutdown) { shutdown("SIGTERM"); await vi.waitFor(() => expect(disposed).toBe(true), { timeout: 5000 }); }
  } finally {
    for (const listener of process.listeners("SIGTERM")) if (!oldTerminate.has(listener)) process.removeListener("SIGTERM", listener);
    for (const listener of process.listeners("SIGINT")) if (!oldInterrupt.has(listener)) process.removeListener("SIGINT", listener);
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

it("production host keeps an earlier loop's voice while a later loop is recorded in another", async (context) => {
  const presets = host.engine.snapshot().synth.soundFontPresets;
  const [first, second] = presets;
  if (!first || !second) return context.skip();
  const submit = async (command: EngineCommand) => expect((await host.server.submit(command)).accepted).toBe(true);

  await submit({ type: "configure", settings: { bpm: 240, loopMeasures: 1, countInEnabled: false, metronomeEnabled: false }, clearAudio: true });
  await submit({ type: "select-synth", synthId: "soundfont" });
  await submit({ type: "select-soundfont-preset", presetId: first.id });
  await submit({ type: "play" });
  input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
  input({ type: "note-off", channel: 0, note: 60 });
  await vi.waitFor(() => expect(host.engine.snapshot().capture.staged?.voice?.presetId).toBe(first.id), { timeout: 4000 });
  await submit({ type: "promote-staged" });

  await submit({ type: "select-soundfont-preset", presetId: second.id });
  await vi.waitFor(() => expect(host.engine.snapshot().capture.staged?.voice?.presetId).toBe(second.id), { timeout: 4000 });
  await submit({ type: "stop" });

  expect(host.engine.snapshot().promoted[0]?.voice).toMatchObject({ presetId: first.id, bank: first.bank, program: first.program });
  expect(global.at(-1)).toEqual([second.bank, second.program]);
  const firstCall = pinned.find(([, bank, program]) => bank === first.bank && program === first.program);
  expect(firstCall, "the earlier loop's voice was pinned on its channel").toBeDefined();
  const secondCall = pinned.find(([, bank, program]) => bank === second.bank && program === second.program);
  expect(secondCall, "the later loop's voice was pinned on its channel").toBeDefined();
  expect(secondCall![0]).not.toBe(firstCall![0]);
}, 20_000);
