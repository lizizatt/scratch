import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { PROTOCOL_VERSION, type EngineCommand, type EngineSnapshot, type ServerMessage } from "@alesis/protocol";

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Test host timed out")), 5_000); })]);
  } finally { clearTimeout(timer!); }
}

it("persists host pad edits before acknowledgement and restores them in a fresh simulated host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alesis-pad-restart-"));
  const settingsPath = join(directory, "settings.json");
  const children: ChildProcessWithoutNullStreams[] = [];
  const sockets: WebSocket[] = [];
  async function start() {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./main.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, HOST: "127.0.0.1", PORT: "0", MIDI_MODE: "software", AUDIO_MODE: "simulated", SOFTWARE_VORTEX_DEMO: "0", SAMPLE_LIBRARY_DIR: join(directory, "samples"), ALESIS_SETTINGS_PATH: settingsPath },
      stdio: "pipe",
    });
    children.push(child);
    const port = await bounded(new Promise<string>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (data) => {
        output += String(data);
        const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) resolve(match[1]!);
      });
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error(`Test host exited ${code}: ${output}`)));
      child.stderr.on("data", (data) => { output += String(data); });
    }));
    const socket = new WebSocket(`ws://127.0.0.1:${port}/control`);
    sockets.push(socket);
    const initial = new Promise<EngineSnapshot>((resolve) => socket.once("message", (data) => resolve(JSON.parse(String(data)).snapshot)));
    const snapshot = await bounded(initial);
    async function send(command: EngineCommand) {
      const commandId = randomUUID();
      const result = new Promise<Extract<ServerMessage, { type: "command-result" }>>((resolve) => {
        const listener = (data: WebSocket.RawData) => {
          const message = JSON.parse(String(data));
          if (message.type === "command-result" && message.commandId === commandId) { socket.off("message", listener); resolve(message); }
        };
        socket.on("message", listener);
      });
      socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId, command }));
      return bounded(result);
    }
    async function stop() {
      const closed = once(socket, "close");
      socket.close();
      await bounded(closed);
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await bounded(exited);
    }
    return { snapshot, send, stop };
  }
  try {
    const first = await start();
    expect(first.snapshot.pads.samplePageCount).toBe(0);
    expect(await first.send({ type: "configure-pad", mode: "drums", page: 0, pad: 7, action: { kind: "control", target: "metronome", operation: "toggle" } })).toMatchObject({ accepted: true });
    const stored = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(stored.pads.assignments).toEqual([{ mode: "drums", page: 0, pad: 7, action: { kind: "control", target: "metronome", operation: "toggle" } }]);
    await first.stop();
    const second = await start();
    expect(second.snapshot.pads.assignments).toEqual(stored.pads.assignments);
    expect(second.snapshot.pads.samplePageCount).toBe(1);
    expect(await second.send({ type: "trigger-sample-pad", pad: 7, velocity: 100 })).toMatchObject({ accepted: true });
    expect(JSON.parse(await readFile(settingsPath, "utf8")).settings.metronomeEnabled).toBe(false);
    expect(await second.send({ type: "release-sample-pad", pad: 7 })).toMatchObject({ accepted: true });
    await second.stop();
  } finally {
    for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }));
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);