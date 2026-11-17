import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SoftwareVortex, type MidiInputEvent } from "@alesis/midi";
import { SimulatedHostEngine } from "@alesis/engine";
import type { EngineCommand, SavedLoopsStatus } from "@alesis/protocol";
import type { ControlServer } from "./control-server.js";
import type { LoopLibrary } from "./loop-library.js";

const host = vi.hoisted(() => ({} as { engine: SimulatedHostEngine; server: ControlServer; library: LoopLibrary }));
vi.mock("./control-server.js", async (original) => {
  const actual = await original<typeof import("./control-server.js")>();
  return { ...actual, createControlServer: async (...args: Parameters<typeof actual.createControlServer>) => {
    host.engine = args[0] as SimulatedHostEngine;
    host.library = args[9] as unknown as LoopLibrary;
    return host.server = await actual.createControlServer(...args);
  } };
});

let root: string;
let oldInterrupt: Set<(...args: any[]) => void>;
let oldTerminate: Set<(...args: any[]) => void>;
let disposed = false;
let input!: (event: MidiInputEvent) => void;

const submit = (command: EngineCommand) => host.server.submit(command);
const status = (): SavedLoopsStatus => host.library.status();
const playNote = async (note: number) => {
  input({ type: "note-on", channel: 0, note, velocity: 100 });
  await vi.waitFor(() => expect(host.engine.snapshot().capture.staged).not.toBeNull(), { timeout: 4000 });
  input({ type: "note-off", channel: 0, note });
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "alesis-main-loops-"));
  for (const [key, value] of Object.entries({ PORT: "0", HOST: "127.0.0.1", AUDIO_MODE: "simulated", MIDI_MODE: "software", SOFTWARE_VORTEX_DEMO: "0", SAMPLE_LIBRARY_DIR: join(root, "samples"), ALESIS_SETTINGS_PATH: join(root, "settings.json"), ALESIS_EXPORT_DIR: join(root, "exports"), ALESIS_LOOP_LIBRARY_DIR: join(root, "loops") })) vi.stubEnv(key, value);
  oldInterrupt = new Set(process.listeners("SIGINT"));
  oldTerminate = new Set(process.listeners("SIGTERM"));
  const dispose = SimulatedHostEngine.prototype.dispose;
  vi.spyOn(SimulatedHostEngine.prototype, "dispose").mockImplementation(function (this: SimulatedHostEngine) { disposed = true; return dispose.call(this); });
  const subscribe = SoftwareVortex.prototype.subscribe;
  vi.spyOn(SoftwareVortex.prototype, "subscribe").mockImplementation(function (this: SoftwareVortex, listener) { input = listener; return subscribe.call(this, listener); });
  await import("./main.js");
  for (const command of [
    { type: "configure", settings: { bpm: 240, loopMeasures: 1, countInEnabled: false, metronomeEnabled: false }, clearAudio: true },
    { type: "select-synth", synthId: "subtractive" },
    { type: "play" },
  ] satisfies EngineCommand[]) expect((await submit(command)).accepted).toBe(true);
  await playNote(60);
  expect((await submit({ type: "stop" })).accepted).toBe(true);
  expect((await submit({ type: "promote-staged" })).accepted).toBe(true);
}, 60_000);

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

describe("saved loops in the production host", () => {
  it("saves the takes under a name and brings them back after they are gone", async () => {
    const saved = await submit({ type: "save-loop", name: "Verse idea" });
    expect(saved).toMatchObject({ accepted: true, message: expect.stringContaining("Verse idea") });
    expect(status().items).toMatchObject([{ id: "Verse idea", takeCount: 1, bpm: 240 }]);
    expect(await readdir(join(root, "loops"))).toEqual(["Verse idea.json"]);

    const before = host.engine.snapshot().promoted;
    expect(before).toHaveLength(1);
    await submit({ type: "delete-take", takeId: before[0]!.id });
    await submit({ type: "delete-staged" });
    expect(host.engine.snapshot().promoted).toHaveLength(0);

    const loaded = await submit({ type: "load-saved-loop", id: "Verse idea" });
    expect(loaded.accepted, loaded.error).toBe(true);
    const after = host.engine.snapshot();
    expect(after.promoted).toHaveLength(1);
    expect(after.promoted[0]!.waveform.some((sample) => sample !== 0)).toBe(true);
    expect(after.transport.state).toBe("stopped");
  });

  it("will not save or open a loop while the transport is running, nor with nothing to save", async () => {
    await submit({ type: "play" });
    expect(await submit({ type: "save-loop", name: "While playing" })).toMatchObject({ accepted: false, error: expect.stringMatching(/Stop transport/i) });
    expect(await submit({ type: "load-saved-loop", id: "Verse idea" })).toMatchObject({ accepted: false });
    await submit({ type: "stop" });
    expect(status().items.map(({ id }) => id)).toEqual(["Verse idea"]);
    await expect(submit({ type: "load-saved-loop", id: "Never saved" })).rejects.toThrow(/No saved loop/);
  });

  it("keeps the loop alongside an MP3 export so it can be edited again", async () => {
    const exported = await submit({ type: "export-mp3", name: "Exported mix" });
    expect(exported.accepted, exported.error).toBe(true);
    expect(exported.message).toContain('also saved as "Exported mix"');
    expect(status().items.map(({ id }) => id).sort()).toEqual(["Exported mix", "Verse idea"]);
    expect(JSON.parse(await readFile(join(root, "loops", "Exported mix.json"), "utf8")).format).toBe("alesis-loop-session");
  }, 60_000);

  it("keeps the loop alongside a sample export under the sample's own name", async () => {
    const exported = await submit({ type: "export-loop-sample" });
    expect(exported.accepted, exported.error).toBe(true);
    const names = status().items.map(({ id }) => id);
    expect(names.some((id) => /^Loop/.test(id))).toBe(true);
    expect(exported.message).toMatch(/also saved as "Loop/);
  }, 60_000);

  it("deletes a saved loop, and the file browser can list the folder", async () => {
    expect((await submit({ type: "delete-saved-loop", id: "Exported mix" })).accepted).toBe(true);
    expect(status().items.map(({ id }) => id)).not.toContain("Exported mix");
    const listing = await (await fetch(`http://127.0.0.1:${host.server.port}/files/loops/`)).text();
    expect(listing).toContain("Verse idea.json");
    expect(listing).not.toContain("Exported mix.json");
  });
});
