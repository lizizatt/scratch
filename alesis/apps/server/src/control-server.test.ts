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
  it("reports each failed readiness dependency independently", async () => {
    engine = new SimulatedHostEngine();
    server = await createControlServer(engine, 0, undefined, undefined, "127.0.0.1", {
      soundFont: { ready: false, reason: "Required STH.sf2 was not found" },
      synth: { ready: false, reason: "FluidSynth did not start" },
      audio: { ready: false, reason: "CM108 USB audio was not found" },
      midi: { ready: false, reason: "Vortex Wireless 2 was not found" },
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/health`);

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      status: "not-ready",
      dependencies: {
        soundFont: { ready: false, reason: "Required STH.sf2 was not found" },
        synth: { ready: false, reason: "FluidSynth did not start" },
        audio: { ready: false, reason: "CM108 USB audio was not found" },
        midi: { ready: false, reason: "Vortex Wireless 2 was not found" },
      },
    });
  });

  it("stays stopped and rejects play while a required dependency is not ready", async () => {
    engine = new SimulatedHostEngine();
    server = await createControlServer(engine, 0, undefined, undefined, "127.0.0.1", {
      soundFont: { ready: true, identity: "STH.sf2" },
      synth: { ready: true, identity: "FluidSynth" },
      audio: { ready: false, reason: "CM108 USB audio was not found" },
      midi: { ready: true, identity: "Vortex Wireless 2" },
    });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();

    socket.send(JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      commandId: "75e35298-48e6-48c0-a464-f06473725fc8",
      command: { type: "play" },
    }));

    const messages = await collectUntil(inbox, (message) => message.type === "command-result");
    expect(messages.at(-1)).toMatchObject({ accepted: false, error: "Not Ready: audio: CM108 USB audio was not found" });
    expect(engine.snapshot().transport.state).toBe("stopped");
    socket.close();
  });

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
    expect(initial).toMatchObject({
      type: "snapshot",
      readiness: {
        soundFont: { ready: true },
        synth: { ready: true },
        audio: { ready: true },
        midi: { ready: true },
      },
    });

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

  it("serializes host-submitted MIDI selections with WebSocket mutations", async () => {
    engine = new SimulatedHostEngine({ drumKits: [
      { id: "kit-a", bank: 128, program: 0, name: "A" },
      { id: "kit-b", bank: 128, program: 1, name: "B" },
    ] });
    const order: string[] = [];
    const executeCommand = vi.fn(async (command) => {
      order.push(`start:${command.type}`);
      await Promise.resolve();
      const result = await engine!.execute(command);
      order.push(`end:${command.type}`);
      return result;
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();

    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "3958a14d-8146-4ae7-8ff6-959615dc2057", command: { type: "set-pad-navigation-target", target: "drum-kits" } }));
    await collectUntil(inbox, (message) => message.type === "command-result");
    const midiSelection = server.submit({ type: "step-pad-navigation", direction: 1 });
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "67ee1c87-9610-4568-966f-eae39b511bf5", command: { type: "step-pad-navigation", direction: 1 } }));
    await midiSelection;
    await collectUntil(inbox, (message) => message.type === "command-result");

    expect(order).toEqual([
      "start:set-pad-navigation-target", "end:set-pad-navigation-target",
      "start:step-pad-navigation", "end:step-pad-navigation",
      "start:step-pad-navigation", "end:step-pad-navigation",
    ]);
    expect(engine.snapshot().pads).toMatchObject({ selectedDrumKitId: "kit-a", navigationIndex: 0 });
    socket.close();
  });

  it("executes mutating commands in receive order", async () => {
    engine = new SimulatedHostEngine();
    let releasePlay!: () => void;
    const playGate = new Promise<void>((resolve) => { releasePlay = resolve; });
    const order: string[] = [];
    const executeCommand = vi.fn(async (command) => {
      order.push(`start:${command.type}`);
      if (command.type === "play") await playGate;
      const result = await engine!.execute(command);
      order.push(`end:${command.type}`);
      return result;
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();

    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "01f84aaf-d5da-42ec-a791-7ee67d3af381", command: { type: "play" } }));
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "48a1cebf-a919-447e-b3d4-e120bc49f3df", command: { type: "stop" } }));
    await vi.waitFor(() => expect(order).toEqual(["start:play"]));
    releasePlay();
    await collectCommandResults(inbox, 2);

    expect(order).toEqual(["start:play", "end:play", "start:stop", "end:stop"]);
    expect(engine.snapshot().transport.state).toBe("stopped");
    socket.close();
  });

  it("shares one in-flight execution for duplicate command IDs", async () => {
    engine = new SimulatedHostEngine();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const executeCommand = vi.fn(async (command) => {
      await gate;
      return engine!.execute(command);
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    const envelope = { protocolVersion: PROTOCOL_VERSION, commandId: "0c62f21e-e11c-4191-a9d8-b246045950b2", command: { type: "play" } };

    socket.send(JSON.stringify(envelope));
    socket.send(JSON.stringify(envelope));
    await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));
    release();
    const results = await collectCommandResults(inbox, 2);

    expect(results[0]).toEqual(results[1]);
    expect(executeCommand).toHaveBeenCalledTimes(1);
    socket.close();
  });

  it("does not hold Stop behind a long-running export", async () => {
    engine = new SimulatedHostEngine();
    let releaseExport!: () => void;
    const exportGate = new Promise<void>((resolve) => { releaseExport = resolve; });
    const executeCommand = vi.fn(async (command) => {
      if (command.type === "export-mp3") {
        await exportGate;
        const snapshot = engine!.snapshot();
        return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
      }
      return engine!.execute(command);
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();

    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "2030495e-26db-46d2-8283-8f01c3310fac", command: { type: "export-mp3", name: "Session" } }));
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "4f05d5d7-99b8-49c0-a116-c437f61620fd", command: { type: "stop" } }));
    const firstResult = (await collectUntil(inbox, (message) => message.type === "command-result")).at(-1);

    expect(firstResult).toMatchObject({ type: "command-result", commandId: "4f05d5d7-99b8-49c0-a116-c437f61620fd", accepted: true });
    releaseExport();
    await collectUntil(inbox, (message) => message.type === "command-result" && message.commandId === "2030495e-26db-46d2-8283-8f01c3310fac");
    socket.close();
  });

  it("starts export after mutations received before it", async () => {
    engine = new SimulatedHostEngine();
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const order: string[] = [];
    const executeCommand = vi.fn(async (command) => {
      order.push(`start:${command.type}`);
      if (command.type === "select-synth") await mutationGate;
      const snapshot = engine!.snapshot();
      const result = command.type === "export-mp3"
        ? { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle }
        : await engine!.execute(command);
      order.push(`end:${command.type}`);
      return result;
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();

    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "da69b458-bace-4d76-a61b-7a806d9dfc3e", command: { type: "select-synth", synthId: "subtractive" } }));
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "496bd415-f7d0-4bba-a73b-da323add3bf5", command: { type: "export-mp3", name: "Session" } }));
    await vi.waitFor(() => expect(order).toEqual(["start:select-synth"]));
    releaseMutation();
    await collectCommandResults(inbox, 2);

    expect(order).toEqual(["start:select-synth", "end:select-synth", "start:export-mp3", "end:export-mp3"]);
    socket.close();
  });

  it("returns executor exceptions as rejected command results", async () => {
    engine = new SimulatedHostEngine();
    server = await createControlServer(engine, 0, undefined, async () => { throw new Error("catalog failed"); });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();

    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "612f1dbb-e388-440d-817f-b775e1028d19", command: { type: "refresh-soundfonts" } }));
    const messages = await collectUntil(inbox, (message) => message.type === "command-result");

    expect(messages.at(-1)).toMatchObject({ accepted: false, error: "Command failed: catalog failed" });
    socket.close();
  });

  it("coalesces high-rate MIDI updates while delivering the latest state", async () => {
    engine = new SimulatedHostEngine();
    server = await createControlServer(engine);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    const updates: ServerMessage[] = [];
    socket.on("message", (data) => {
      const message = serverMessageSchema.parse(JSON.parse(data.toString()));
      if (message.type === "snapshot-update") updates.push(message);
    });

    for (let index = 0; index < 256; index += 1) {
      engine.dispatchMidi({ type: "pitch-bend", channel: 0, value: index / 255 * 2 - 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(updates.length).toBeGreaterThan(0);
    expect(updates.length).toBeLessThanOrEqual(4);
    expect(updates.at(-1)).toMatchObject({
      update: {
        engine: { midiEventsReceived: 256, lastMidiEvent: "pitch-bend" },
        synth: expect.any(Object),
        pads: expect.any(Object),
      },
    });
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

async function collectCommandResults(inbox: MessageInbox, count: number): Promise<ServerMessage[]> {
  const results: ServerMessage[] = [];
  while (results.length < count) {
    const message = await inbox.next();
    if (message.type === "command-result") results.push(message);
  }
  return results;
}
