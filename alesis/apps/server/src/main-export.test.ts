import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { SoftwareVortex, type MidiInputEvent } from "@alesis/midi";
import { SimulatedHostEngine } from "@alesis/engine";
import { PROTOCOL_VERSION, idleLoopExport, type EngineCommand, type ServerMessage } from "@alesis/protocol";
import type { ControlServer } from "./control-server.js";

const host = vi.hoisted(() => ({} as { engine: SimulatedHostEngine; server: ControlServer }));
vi.mock("./control-server.js", async (original) => {
  const actual = await original<typeof import("./control-server.js")>();
  return { ...actual, createControlServer: async (...args: Parameters<typeof actual.createControlServer>) => {
    host.engine = args[0] as SimulatedHostEngine;
    return host.server = await actual.createControlServer(...args);
  } };
});

type Result = Extract<ServerMessage, { type: "command-result" }>;
async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${host.server.port}/control`);
  const results = new Map<string, (result: Result) => void>();
  let status = { ...idleLoopExport };
  const ready = new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("message", () => resolve());
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as ServerMessage;
    if (message.type === "snapshot") status = message.loopExport;
    if (message.type === "loop-export-status") status = message.status;
    if (message.type === "command-result") results.get(message.commandId)?.(message);
  });
  await ready;
  return {
    status: () => status,
    command(command: EngineCommand): Promise<Result> {
      const commandId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { results.delete(commandId); reject(new Error("Control timeout")); }, 10_000);
        results.set(commandId, (result) => { clearTimeout(timer); results.delete(commandId); resolve(result); });
        socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId, command }));
      });
    },
    close: () => new Promise<void>((resolve) => { socket.once("close", resolve); socket.close(); }),
  };
}

let root: string;
let samples: string;
let exportsRoot: string;
let oldInterrupt: Set<(...args: any[]) => void>;
let oldTerminate: Set<(...args: any[]) => void>;
let disposed = false;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "alesis-main-export-"));
  samples = join(root, "samples");
  exportsRoot = join(root, "exports");
  for (const [key, value] of Object.entries({ PORT: "0", HOST: "127.0.0.1", AUDIO_MODE: "simulated", MIDI_MODE: "software", SOFTWARE_VORTEX_DEMO: "0", SAMPLE_LIBRARY_DIR: samples, ALESIS_SETTINGS_PATH: join(root, "settings.json"), ALESIS_EXPORT_DIR: exportsRoot })) vi.stubEnv(key, value);
  oldInterrupt = new Set(process.listeners("SIGINT"));
  oldTerminate = new Set(process.listeners("SIGTERM"));
  const dispose = SimulatedHostEngine.prototype.dispose;
  vi.spyOn(SimulatedHostEngine.prototype, "dispose").mockImplementation(function (this: SimulatedHostEngine) { disposed = true; return dispose.call(this); });
  const subscribe = SoftwareVortex.prototype.subscribe;
  let input!: (event: MidiInputEvent) => void;
  vi.spyOn(SoftwareVortex.prototype, "subscribe").mockImplementation(function (this: SoftwareVortex, listener) { input = listener; return subscribe.call(this, listener); });
  await import("./main.js");
  for (const command of [
    { type: "configure", settings: { bpm: 240, loopMeasures: 1, countInEnabled: false, metronomeEnabled: false }, clearAudio: true },
    { type: "select-synth", synthId: "subtractive" },
    { type: "play" },
  ] satisfies EngineCommand[]) expect((await host.server.submit(command)).accepted).toBe(true);
  input({ type: "note-on", channel: 0, note: 60, velocity: 100 });
  await vi.waitFor(() => expect(host.engine.snapshot().capture.staged).not.toBeNull(), { timeout: 2500 });
  input({ type: "note-off", channel: 0, note: 60 });
  expect((await host.server.submit({ type: "stop" })).accepted).toBe(true);
  expect((await host.server.submit({ type: "promote-staged" })).accepted).toBe(true);
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

it.each(["export-loop-sample", "export-mp3"] as const)("production %s releases failed publications for retry without touching another owner", async (type) => {
  const client = await connect();
  const other = await connect();
  const command: EngineCommand = type === "export-mp3" ? { type, name: "legacy-retry" } : { type };
  try {
    const artifactId = randomUUID();
    expect((await other.command({ type: "prepare-loop-export", artifactId, target: "sample", startBeat: 0 })).accepted).toBe(true);
    const blocked = await client.command(command);
    expect(blocked.accepted).toBe(false);
    expect(blocked.error).toContain("Another export is active");
    expect(other.status()).toMatchObject({ state: "ready", artifactId });
    expect((await other.command({ type: "preview-loop-export", artifactId, enabled: true })).accepted).toBe(true);
    expect((await other.command({ type: "release-loop-export", artifactId })).accepted).toBe(true);

    const obstruction = type === "export-mp3" ? join(exportsRoot, "legacy-retry") : join(samples, ".loop-sample-sequence");
    if (type === "export-mp3") await mkdir(obstruction, { recursive: true });
    else await mkdir(samples, { recursive: true });
    const sentinel = type === "export-mp3" ? join(obstruction, "keep.txt") : obstruction;
    await writeFile(sentinel, "existing user data");
    const failed = await client.command(command);
    expect(failed.accepted).toBe(false);
    expect(failed.error).toContain("EEXIST");
    expect(await readFile(sentinel, "utf8")).toBe("existing user data");
    await rm(obstruction, { recursive: true });

    const retry = await client.command(command);
    expect(retry.accepted, retry.error).toBe(true);
    expect(client.status()).toMatchObject({ state: "idle", artifactId: null });
    const destination = type === "export-mp3" ? obstruction : samples;
    const files = (await readdir(destination)).filter((name) => name.endsWith(".mp3"));
    expect(files.length).toBe(type === "export-mp3" ? 2 : 1);
    for (const file of files) expect((await stat(join(destination, file))).size).toBeGreaterThan(1000);

    // Successful legacy publication must also leave the slot available to a new connection.
    const nextId = randomUUID();
    expect((await other.command({ type: "prepare-loop-export", artifactId: nextId, target: "sample", startBeat: 0 })).accepted).toBe(true);
    expect((await other.command({ type: "release-loop-export", artifactId: nextId })).accepted).toBe(true);
  } finally {
    await client.close();
    await vi.waitFor(() => expect(other.status().artifactId).toBeNull());
    await other.close();
  }
}, 20_000);
