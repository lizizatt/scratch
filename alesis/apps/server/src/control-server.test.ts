import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SimulatedHostEngine } from "@alesis/engine";
import { PROTOCOL_VERSION, serverMessageSchema, type ServerMessage } from "@alesis/protocol";
import WebSocket from "ws";
import { createControlServer, type ControlServer } from "./control-server.js";

let server: ControlServer | undefined;
let engine: SimulatedHostEngine | undefined;
const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await server?.close();
  await engine?.dispose();
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
  server = undefined;
  engine = undefined;
});

describe("control server", () => {
  it("serves assets created after startup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alesis-static-test-"));
    temporaryDirectories.add(directory);
    await writeFile(join(directory, "index.html"), "<h1>Alesis</h1>");
    engine = new SimulatedHostEngine();
    server = await createControlServer(engine, 0, directory);

    await writeFile(join(directory, "rebuilt.js"), "export const rebuilt = true;");

    const response = await fetch(`http://127.0.0.1:${server.port}/rebuilt.js`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("export const rebuilt = true;");
  });

  it("sends authoritative state and applies valid commands", async () => {
    engine = new SimulatedHostEngine();
    server = await createControlServer(engine);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);

    const initial = await inbox.next();
    expect(initial.type).toBe("snapshot");

    socket.send(JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "90786ed3-b479-4417-959f-36b31834a659",
      command: { type: "play" },
    }));

    const messages = await collectUntil(inbox, (message) => message.type === "command-result");
    const result = messages.find((message) => message.type === "command-result");
    expect(result).toMatchObject({ accepted: true, appliedCycle: 0 });
    expect(engine.snapshot().transport.state).toBe("counting-in");
    socket.close();
  });

  it("deduplicates retried command IDs", async () => {
    engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 4, loopMeasures: 1 } });
    await engine.execute({ type: "play" });
    engine.advance(2);
    server = await createControlServer(engine);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: "2a067d13-4f29-4c22-9ddf-cb7a24a21ab0",
      command: { type: "promote-staged" },
    };

    socket.send(JSON.stringify(envelope));
    await collectUntil(inbox, (message) => message.type === "command-result");
    socket.send(JSON.stringify(envelope));
    await collectUntil(inbox, (message) => message.type === "command-result");

    expect(engine.snapshot().promoted).toHaveLength(1);
    socket.close();
  });

  it("routes commands through a host executor", async () => {
    engine = new SimulatedHostEngine();
    const executeCommand = vi.fn((command) => engine!.execute(command));
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    socket.send(JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "7b9eff8a-730e-4f0f-aa58-e603bf1125c0",
      command: { type: "play" },
    }));

    await collectUntil(inbox, (message) => message.type === "command-result");
    expect(executeCommand).toHaveBeenCalledWith({ type: "play" });
    socket.close();
  });

  it("coalesces high-rate MIDI updates while delivering the latest state", async () => {
    engine = new SimulatedHostEngine();
    server = await createControlServer(engine);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    const snapshots: ServerMessage[] = [];
    socket.on("message", (data) => {
      const message = serverMessageSchema.parse(JSON.parse(data.toString()));
      if (message.type === "snapshot") snapshots.push(message);
    });

    for (let index = 0; index < 256; index += 1) {
      engine.dispatchMidi({ type: "pitch-bend", channel: 0, value: index / 255 * 2 - 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.length).toBeLessThanOrEqual(4);
    expect(snapshots.at(-1)).toMatchObject({ snapshot: { engine: { midiEventsReceived: 256, lastMidiEvent: "pitch-bend" } } });
    socket.close();
  });

  it("closes clients that send malformed commands", async () => {
    engine = new SimulatedHostEngine();
    server = await createControlServer(engine);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    socket.send("not json");

    const closeCode = await new Promise<number>((resolve) => socket.once("close", resolve));
    expect(closeCode).toBe(1008);
  });
});

class MessageInbox {
  private messages: ServerMessage[] = [];
  private waiters: Array<(message: ServerMessage) => void> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      const message = serverMessageSchema.parse(JSON.parse(data.toString()));
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.messages.push(message);
    });
  }

  next(): Promise<ServerMessage> {
    const message = this.messages.shift();
    if (message) return Promise.resolve(message);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

async function collectUntil(inbox: MessageInbox, predicate: (message: ServerMessage) => boolean): Promise<ServerMessage[]> {
  const messages: ServerMessage[] = [];
  while (true) {
    const message = await inbox.next();
    messages.push(message);
    if (predicate(message)) return messages;
  }
}
