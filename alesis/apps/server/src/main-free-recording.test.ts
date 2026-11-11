import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMidi } from "midi-file";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SilentAudioOutput } from "@alesis/audio";
import { SoftwareVortex, type MidiInputEvent } from "@alesis/midi";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import type { EngineCommand, FreeRecordingStatus } from "@alesis/protocol";
import type { ControlServer } from "./control-server.js";
import type { FreeRecordings } from "./free-recordings.js";

const host = vi.hoisted(() => ({} as { engine: SimulatedHostEngine; server: ControlServer; recordings: FreeRecordings }));
vi.mock("./control-server.js", async (original) => {
  const actual = await original<typeof import("./control-server.js")>();
  return { ...actual, createControlServer: async (...args: Parameters<typeof actual.createControlServer>) => {
    host.engine = args[0] as SimulatedHostEngine;
    host.recordings = args[7] as unknown as FreeRecordings;
    return host.server = await actual.createControlServer(...args);
  } };
});

let root: string;
let oldInterrupt: Set<(...args: any[]) => void>;
let oldTerminate: Set<(...args: any[]) => void>;
let disposed = false;
let input!: (event: MidiInputEvent) => void;
const sounded: string[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "alesis-main-free-"));
  for (const [key, value] of Object.entries({ PORT: "0", HOST: "127.0.0.1", AUDIO_MODE: "simulated", MIDI_MODE: "software", SOFTWARE_VORTEX_DEMO: "0", SAMPLE_LIBRARY_DIR: join(root, "samples"), ALESIS_SETTINGS_PATH: join(root, "settings.json"), ALESIS_EXPORT_DIR: join(root, "exports"), ALESIS_FREE_RECORDING_DIR: join(root, "free") })) vi.stubEnv(key, value);
  oldInterrupt = new Set(process.listeners("SIGINT"));
  oldTerminate = new Set(process.listeners("SIGTERM"));
  const dispose = SimulatedHostEngine.prototype.dispose;
  vi.spyOn(SimulatedHostEngine.prototype, "dispose").mockImplementation(function (this: SimulatedHostEngine) { disposed = true; return dispose.call(this); });
  const subscribe = SoftwareVortex.prototype.subscribe;
  vi.spyOn(SoftwareVortex.prototype, "subscribe").mockImplementation(function (this: SoftwareVortex, listener) { input = listener; return subscribe.call(this, listener); });
  vi.spyOn(SilentAudioOutput.prototype, "dispatchMidi").mockImplementation(((event: MidiEvent) => { sounded.push(event.type); }) as never);
  await import("./main.js");
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

const submit = (command: EngineCommand) => host.server.submit(command);
const status = (): FreeRecordingStatus => host.recordings.status();
const download = (path: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${host.server.port}${path}`, { headers });

describe("free recording in the production host", () => {
  it("records what is played in Record mode, with no looping, and saves a MIDI file and an MP3", async () => {
    expect((await submit({ type: "start-free-recording" })).error).toMatch(/Switch to Record mode/);
    expect((await submit({ type: "set-capture-mode", mode: "record" })).accepted).toBe(true);
    expect(host.engine.snapshot().capture).toMatchObject({ freeRecord: true, overdub: false });
    expect((await submit({ type: "play" })).error).toMatch(/Record mode/);

    expect((await submit({ type: "start-free-recording" })).accepted).toBe(true);
    expect(status().active).not.toBeNull();
    sounded.length = 0;
    input({ type: "note-on", channel: 1, note: 60, velocity: 100 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    input({ type: "pitch-bend", channel: 1, value: 0.25 });
    input({ type: "note-off", channel: 1, note: 60 });
    expect(sounded).toContain("note-on");
    expect(status().active).toMatchObject({ noteCount: 1 });
    expect(host.engine.snapshot().transport.state).toBe("stopped");

    // The mode and the sound source are locked while recording.
    for (const command of [{ type: "set-capture-mode", mode: "replace" }, { type: "set-overdub", enabled: true }, { type: "select-synth", synthId: "subtractive" }] as const) {
      expect(await submit(command)).toMatchObject({ accepted: false, error: "Stop the recording first" });
    }

    expect((await submit({ type: "stop-free-recording" })).accepted).toBe(true);
    const [item] = status().items;
    expect(item).toMatchObject({ noteCount: 1, recovered: false });
    const midi = parseMidi(await readFile(join(root, "free", `${item!.id}.mid`)));
    expect(midi.tracks[0]!.filter((event) => event.type === "noteOn").map((event) => [(event as { channel: number }).channel, (event as { noteNumber: number }).noteNumber])).toEqual([[1, 60]]);
    expect(midi.tracks[0]!.some((event) => event.type === "pitchBend" && event.channel === 1)).toBe(true);

    await vi.waitFor(() => expect(status().items[0]!.mp3.state).toBe("ready"), { timeout: 30_000 });
    const mid = await download(`/recordings/${item!.id}.mid`);
    expect(mid.status).toBe(200);
    expect(mid.headers.get("content-type")).toBe("audio/midi");
    expect(mid.headers.get("content-disposition")).toMatch(/^attachment; filename="Jam [\w .-]+\.mid"$/);
    expect(Buffer.from(await mid.arrayBuffer()).subarray(0, 4).toString()).toBe("MThd");
    const mp3 = await download(`/recordings/${item!.id}.mp3`, { range: "bytes=0-9" });
    expect(mp3.status).toBe(206);
    expect(mp3.headers.get("content-range")).toMatch(/^bytes 0-9\/\d+$/);
    expect((await mp3.arrayBuffer()).byteLength).toBe(10);
  }, 60_000);

  it("refuses downloads of anything that is not a finished recording", async () => {
    for (const path of ["/recordings/jam-20000101-000000.mid", "/recordings/jam-1.txt", "/recordings/%2e%2e%2fx.mid", "/recordings/", "/recordings/jam-20000101-000000.mp3?x=1"]) {
      expect((await download(path)).status, path).toBe(404);
    }
    const response = await fetch(`http://127.0.0.1:${host.server.port}/recordings/${status().items[0]!.id}.mid`, { method: "POST" });
    expect(response.status).not.toBe(200);
  });

  it("closes held notes when the host is panicked and never records a muted-by-panic pedal as held", async () => {
    await submit({ type: "start-free-recording" });
    input({ type: "control-change", channel: 1, controller: 64, value: 127 });
    input({ type: "note-on", channel: 1, note: 64, velocity: 90 });
    await submit({ type: "panic" });
    input({ type: "note-off", channel: 1, note: 64 });
    await submit({ type: "stop-free-recording" });
    const item = status().items[0]!;
    const track = parseMidi(await readFile(join(root, "free", `${item.id}.mid`))).tracks[0]!;
    expect(track.filter((event) => event.type === "noteOff")).toHaveLength(1);
    expect(track.filter((event) => event.type === "controller" && event.controllerType === 64).map((event) => (event as { value: number }).value)).toEqual([127, 0]);
  }, 30_000);

  it("discards an empty recording, and lets Replace and Overdub swap while playing", async () => {
    await submit({ type: "start-free-recording" });
    await submit({ type: "stop-free-recording" });
    expect(status().error).toMatch(/Nothing was played/);
    expect(status().items).toHaveLength(2);

    expect((await submit({ type: "set-capture-mode", mode: "replace" })).accepted).toBe(true);
    expect((await submit({ type: "play" })).accepted).toBe(true);
    expect((await submit({ type: "set-overdub", enabled: true })).accepted).toBe(true);
    expect((await submit({ type: "set-capture-mode", mode: "record" })).error).toMatch(/Stop the transport/);
    expect((await submit({ type: "stop" })).accepted).toBe(true);
    expect((await submit({ type: "set-capture-mode", mode: "record" })).accepted).toBe(true);
    expect((await submit({ type: "set-overdub", enabled: false })).accepted).toBe(true);
    expect(host.engine.snapshot().capture.freeRecord).toBe(false);
  }, 30_000);

  it("deletes a recording and its files", async () => {
    const id = status().items[0]!.id;
    expect((await submit({ type: "delete-free-recording", id })).accepted).toBe(true);
    expect(status().items.map((item) => item.id)).not.toContain(id);
    expect((await download(`/recordings/${id}.mid`)).status).toBe(404);
    await expect(submit({ type: "delete-free-recording", id })).rejects.toThrow("Unknown recording");
  });
});
