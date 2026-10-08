import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SimulatedHostEngine } from "@alesis/engine";
import { PROTOCOL_VERSION, serverMessageSchema, type ServerMessage, type EngineCommand } from "@alesis/protocol";
import { randomUUID } from "node:crypto";
import { SilentAudioOutput } from "@alesis/audio";
import { PadPerformance, padControlCommand } from "./pad-performance.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { executeLoopCommand } from "./loop-commands.js";
import WebSocket from "ws";
import { createControlServer, type ControlServer } from "./control-server.js";
import { HardwareProgramChangeNavigationMapper } from "./pad-controls.js";

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
  it("releases failed control presses and their disconnect ownership", async () => {
    engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure-pad", mode: "drums", page: 0, pad: 0, action: { kind: "control", target: "metronome", operation: "toggle" } });
    const control = vi.fn(async (action) => ({ ...await engine!.execute(padControlCommand(action, engine!.snapshot())), accepted: false, error: "Cannot save settings" }));
    const pads = new PadPerformance({ snapshot: () => engine!.snapshot(), samples: { trigger: () => false, release: () => true, panic() {} }, drum() {}, control });
    const release = vi.spyOn(pads, "release");
    server = await createControlServer(engine, 0, undefined, async (command, source = "host") => {
      if (command.type === "trigger-sample-pad") return pads.press(source, command.pad, command.velocity);
      if (command.type === "release-sample-pad") return pads.release(source, command.pad);
      return engine!.execute(command);
    });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    const send = async (command: EngineCommand) => {
      socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: randomUUID(), command }));
      return (await collectUntil(inbox, (message) => message.type === "command-result")).at(-1);
    };
    expect(await send({ type: "trigger-sample-pad", pad: 0, velocity: 100 })).toMatchObject({ accepted: false });
    await send({ type: "trigger-sample-pad", pad: 0, velocity: 100 });
    expect(control).toHaveBeenCalledTimes(1);
    await send({ type: "release-sample-pad", pad: 0 });
    expect(release).toHaveBeenCalledTimes(1);
    expect(await send({ type: "trigger-sample-pad", pad: 0, velocity: 100 })).toMatchObject({ accepted: false });
    expect(control).toHaveBeenCalledTimes(2);
    await closeSocket(socket);
    await server.close();
    server = undefined;
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("retains another client's sample hold on disconnect and ignores stale/non-owner releases", async () => {
    engine = new SimulatedHostEngine();
    await engine.execute({ type: "set-pad-mode", mode: "samples" });
    const samples = { trigger: vi.fn(() => true), release: vi.fn(() => true), panic: vi.fn() };
    const pads = new PadPerformance({ snapshot: () => engine!.snapshot(), samples, drum() {}, control: async () => null });
    server = await createControlServer(engine, 0, undefined, async (command, source = "host") => {
      if (command.type === "trigger-sample-pad") return pads.press(source, command.pad, command.velocity);
      if (command.type === "release-sample-pad") return pads.release(source, command.pad);
      return engine!.execute(command);
    });
    const clients = [new WebSocket(`ws://127.0.0.1:${server.port}/control`), new WebSocket(`ws://127.0.0.1:${server.port}/control`)];
    const inboxes = clients.map((socket) => new MessageInbox(socket));
    await Promise.all(inboxes.map((inbox) => inbox.next()));
    const send = async (client: number, command: EngineCommand) => {
      clients[client]!.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: randomUUID(), command }));
      return (await collectUntil(inboxes[client]!, (message) => message.type === "command-result")).at(-1);
    };
    await send(0, { type: "trigger-sample-pad", pad: 0, velocity: 100 });
    await send(1, { type: "release-sample-pad", pad: 0 });
    expect(samples.release).not.toHaveBeenCalled();
    await send(1, { type: "trigger-sample-pad", pad: 0, velocity: 100 });
    await closeSocket(clients[0]!);
    await server.submit({ type: "configure", settings: {} });
    expect(samples.release).not.toHaveBeenCalled();
    await send(1, { type: "release-sample-pad", pad: 0 });
    expect(samples.release).toHaveBeenCalledExactlyOnceWith(0);
    await closeSocket(clients[1]!);
  });

  it("executes hardware and browser transport pads through queued stop cleanup, never toggling on disconnect", async () => {
    engine = new SimulatedHostEngine();
    await engine.execute({ type: "configure", settings: { countInEnabled: false } });
    await engine.execute({ type: "configure-pad", mode: "drums", page: 0, pad: 0, action: { kind: "control", target: "transport", operation: "toggle" } });
    const loops = new MidiLoopScheduler(new SilentAudioOutput());
    const transaction = vi.fn();
    let pads: PadPerformance;
    const execute = async (command: EngineCommand, source = "host") => {
      if (command.type === "trigger-sample-pad") return pads.press(source, command.pad, command.velocity);
      if (command.type === "release-sample-pad") return pads.release(source, command.pad);
      return executeLoopCommand(command, engine!, loops, { async transaction<T>(action: () => Promise<T>) { transaction(); return action(); } });
    };
    server = await createControlServer(engine, 0, undefined, execute);
    pads = new PadPerformance({
      snapshot: () => engine!.snapshot(), samples: { trigger: () => true, release: () => true, panic() {} }, drum() {},
      control(action, valid, source) {
        return source === "hardware" ? server!.submit(() => valid() ? padControlCommand(action, engine!.snapshot()) : null)
          : execute(padControlCommand(action, engine!.snapshot()));
      },
    });
    const first = pads.press("hardware", 0, 100);
    pads.release("hardware", 0);
    await first;
    expect(engine.snapshot().transport.state).toBe("playing");
    loops.record({ type: "note-on", channel: 0, note: 60, velocity: 100 }, engine.snapshot());
    expect(loops.hasCurrentRecording()).toBe(true);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    const envelope = { protocolVersion: PROTOCOL_VERSION, commandId: randomUUID(), command: { type: "trigger-sample-pad", pad: 0, velocity: 100 } };
    socket.send(JSON.stringify(envelope));
    expect((await collectUntil(inbox, (message) => message.type === "command-result")).at(-1)).toMatchObject({ accepted: true });
    expect(engine.snapshot().transport.state).toBe("stopped");
    expect(loops.hasCurrentRecording()).toBe(false);
    expect(transaction).toHaveBeenCalledTimes(1);
    socket.send(JSON.stringify(envelope));
    await collectUntil(inbox, (message) => message.type === "command-result");
    await closeSocket(socket);
    await server.close();
    server = undefined;
    expect(engine.snapshot().transport.state).toBe("stopped");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

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

  it("maps host-submitted MIDI selections after earlier queued mutations have executed", async () => {
    engine = new SimulatedHostEngine({
      soundFontPresets: Array.from({ length: 4 }, (_, index) => ({ id: `voice-${index}`, bank: 0, program: index, name: `Voice ${index}` })),
      selectedSoundFontPresetId: "voice-0",
    });
    engine.setSamplePage(0, 3, Array(8).fill(null));
    const mapper = new HardwareProgramChangeNavigationMapper();
    await engine.execute(mapper.commandForProgramChange(1, engine.snapshot()).command!);

    let releaseTarget!: () => void;
    const targetGate = new Promise<void>((resolve) => { releaseTarget = resolve; });
    const executeCommand = vi.fn(async (command) => {
      if (command.type === "set-pad-navigation-target") await targetGate;
      return engine!.execute(command);
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();

    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "a305af6d-5f25-49b9-9469-8b937666d62b", command: { type: "set-pad-navigation-target", target: "sample-pages" } }));
    await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledWith({ type: "set-pad-navigation-target", target: "sample-pages" }));
    const midiSelection = server.submit(() => mapper.commandForProgramChange(5, engine!.snapshot()).command);

    releaseTarget();
    await midiSelection;
    await collectUntil(inbox, (message) => message.type === "command-result");

    expect(engine.snapshot().pads).toMatchObject({ navigationTarget: "sample-pages", navigationIndex: 2, samplePageIndex: 2 });
    socket.close();
  });

  it("drops queued MIDI selections captured before a hardware mapper reset", async () => {
    engine = new SimulatedHostEngine({
      soundFontPresets: Array.from({ length: 4 }, (_, index) => ({ id: `voice-${index}`, bank: 0, program: index, name: `Voice ${index}` })),
      selectedSoundFontPresetId: "voice-0",
    });
    const mapper = new HardwareProgramChangeNavigationMapper();
    let releaseBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => { releaseBlocker = resolve; });
    const executeCommand = vi.fn(async (command) => {
      if (command.type === "configure") await blocker;
      return engine!.execute(command);
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);

    const blockingCommand = server.submit({ type: "configure", settings: { bpm: 96 } });
    await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledWith({ type: "configure", settings: { bpm: 96 } }));
    const staleGeneration = mapper.generation;
    const staleMidiSelection = server.submit(() => mapper.commandForProgramChange(1, engine!.snapshot(), staleGeneration)?.command ?? null);
    mapper.reset();

    releaseBlocker();
    await blockingCommand;
    await expect(staleMidiSelection).resolves.toBeNull();
    const firstReconnectedSelection = await server.submit(() => mapper.commandForProgramChange(1, engine!.snapshot(), mapper.generation)?.command ?? null);

    expect(firstReconnectedSelection?.accepted).toBe(true);
    expect(engine.snapshot().pads.navigationIndex).toBe(1);
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

  it("releases only this connection's held sample pads after its socket closes", async () => {
    engine = new SimulatedHostEngine();
    const executed: Array<{ type: string; pad?: number }> = [];
    const executeCommand = vi.fn(async (command) => {
      executed.push(command);
      const snapshot = engine!.snapshot();
      return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const first = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const second = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const firstInbox = new MessageInbox(first);
    const secondInbox = new MessageInbox(second);
    await Promise.all([firstInbox.next(), secondInbox.next()]);

    first.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "81361514-75b5-41a5-bde4-58fb2b58628f", command: { type: "trigger-sample-pad", pad: 2, velocity: 100 } }));
    second.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "ad18d67b-a3c0-47b9-9daf-bbc411cab62a", command: { type: "trigger-sample-pad", pad: 5, velocity: 100 } }));
    await Promise.all([
      collectUntil(firstInbox, (message) => message.type === "command-result"),
      collectUntil(secondInbox, (message) => message.type === "command-result"),
    ]);

    await closeSocket(first);
    await vi.waitFor(() => expect(executed).toHaveLength(3));
    expect(executed).toEqual([
      { type: "trigger-sample-pad", pad: 2, velocity: 100 },
      { type: "trigger-sample-pad", pad: 5, velocity: 100 },
      { type: "release-sample-pad", pad: 2 },
    ]);
    await closeSocket(second);
    await server.close();
    server = undefined;

    expect(executed).toEqual([
      { type: "trigger-sample-pad", pad: 2, velocity: 100 },
      { type: "trigger-sample-pad", pad: 5, velocity: 100 },
      { type: "release-sample-pad", pad: 2 },
      { type: "release-sample-pad", pad: 5 },
    ]);
  });

  it("does not release a stale hold after a sample-page reset reuses the pad", async () => {
    engine = new SimulatedHostEngine();
    await engine.execute({ type: "set-pad-navigation-target", target: "sample-pages" });
    engine.setSamplePage(0, 2, Array(8).fill(null));
    engine.setSampleLibraryStatus("ready");
    const executed: Array<{ type: string; pad?: number }> = [];
    const executeCommand = vi.fn(async (command) => {
      executed.push(command);
      if (command.type === "select-pad-program") {
        engine!.setSamplePage(command.program, 2, Array(8).fill(null));
        engine!.setSampleLibraryStatus("loading");
      }
      const snapshot = engine!.snapshot();
      return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const oldSocket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const oldInbox = new MessageInbox(oldSocket);
    await oldInbox.next();
    oldSocket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "00b14344-1484-40f1-b13d-b68e67a95ba4", command: { type: "trigger-sample-pad", pad: 3, velocity: 100 } }));
    await collectUntil(oldInbox, (message) => message.type === "command-result");

    await server.submit({ type: "select-pad-program", program: 1 });

    const newSocket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const newInbox = new MessageInbox(newSocket);
    await newInbox.next();
    newSocket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "574b63c7-e800-4f5a-8a31-68cbd0507468", command: { type: "trigger-sample-pad", pad: 3, velocity: 100 } }));
    await collectUntil(newInbox, (message) => message.type === "command-result");

    await closeSocket(oldSocket);
    await server.submit({ type: "stop" });
    expect(executed.some(({ type }) => type === "release-sample-pad")).toBe(false);
    await closeSocket(newSocket);
    await server.close();
    server = undefined;

    expect(executed.at(-1)).toEqual({ type: "release-sample-pad", pad: 3 });
    expect(executed.filter(({ type }) => type === "release-sample-pad")).toHaveLength(1);
  });

  it("invalidates held sample pads on explicit panic without a snapshot change", async () => {
    engine = new SimulatedHostEngine();
    const executed: Array<{ type: string; pad?: number }> = [];
    const executeCommand = vi.fn(async (command) => {
      executed.push(command);
      const snapshot = engine!.snapshot();
      return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const oldSocket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const oldInbox = new MessageInbox(oldSocket);
    await oldInbox.next();
    oldSocket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "0bd75930-44e5-45f5-a4dc-1f08c0e0a159", command: { type: "trigger-sample-pad", pad: 2, velocity: 100 } }));
    await collectUntil(oldInbox, (message) => message.type === "command-result");

    server.invalidateSamplePadHolds();

    const newSocket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const newInbox = new MessageInbox(newSocket);
    await newInbox.next();
    newSocket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "f42315f1-f0aa-4d91-b0cf-73eac4347545", command: { type: "trigger-sample-pad", pad: 2, velocity: 100 } }));
    await collectUntil(newInbox, (message) => message.type === "command-result");

    await closeSocket(oldSocket);
    await server.submit({ type: "stop" });
    expect(executed.filter(({ type }) => type === "release-sample-pad")).toHaveLength(0);
    await closeSocket(newSocket);
    await server.close();
    server = undefined;

    expect(executed.at(-1)).toEqual({ type: "release-sample-pad", pad: 2 });
    expect(executed.filter(({ type }) => type === "release-sample-pad")).toHaveLength(1);
  });

  it("keeps legitimate held pads across unrelated voice navigation", async () => {
    engine = new SimulatedHostEngine({ soundFontPresets: [
      { id: "0:0", bank: 0, program: 0, name: "A" },
      { id: "0:1", bank: 0, program: 1, name: "B" },
    ] });
    const executed: Array<{ type: string; pad?: number }> = [];
    const executeCommand = vi.fn(async (command) => {
      executed.push(command);
      if (command.type === "trigger-sample-pad") {
        const snapshot = engine!.snapshot();
        return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
      }
      const result = await engine!.execute(command);
      return result;
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "061a7ed7-2cd6-4cff-9b87-1b9324141a6c", command: { type: "trigger-sample-pad", pad: 5, velocity: 100 } }));
    await collectUntil(inbox, (message) => message.type === "command-result");

    await server.submit({ type: "step-pad-navigation", direction: 1 });
    await closeSocket(socket);
    await server.close();
    server = undefined;

    expect(executed.at(-1)).toEqual({ type: "release-sample-pad", pad: 5 });
  });

  it("queues held-sample cleanup behind a trigger already executing when the socket closes", async () => {
    engine = new SimulatedHostEngine();
    let releaseTrigger!: () => void;
    const triggerGate = new Promise<void>((resolve) => { releaseTrigger = resolve; });
    const executed: string[] = [];
    const executeCommand = vi.fn(async (command) => {
      executed.push(command.type);
      if (command.type === "trigger-sample-pad") await triggerGate;
      const snapshot = engine!.snapshot();
      return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "9077504c-c6f0-4598-814f-6465422d449b", command: { type: "trigger-sample-pad", pad: 3, velocity: 100 } }));
    await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));

    await closeSocket(socket);
    releaseTrigger();
    await server.close();
    server = undefined;

    expect(executed).toEqual(["trigger-sample-pad", "release-sample-pad"]);
  });

  it("does not treat cached or in-flight duplicate sample triggers as another connection's hold", async () => {
    engine = new SimulatedHostEngine();
    let releaseTrigger!: () => void;
    const triggerGate = new Promise<void>((resolve) => { releaseTrigger = resolve; });
    const executed: Array<{ type: string; pad?: number }> = [];
    const executeCommand = vi.fn(async (command) => {
      executed.push(command);
      if (command.type === "trigger-sample-pad") await triggerGate;
      const snapshot = engine!.snapshot();
      return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const owner = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const duplicate = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const ownerInbox = new MessageInbox(owner);
    const duplicateInbox = new MessageInbox(duplicate);
    await Promise.all([ownerInbox.next(), duplicateInbox.next()]);
    const envelope = { protocolVersion: PROTOCOL_VERSION, commandId: "4251d071-af9e-4a7f-aa1a-0fb0f95533a2", command: { type: "trigger-sample-pad", pad: 4, velocity: 100 } };
    owner.send(JSON.stringify(envelope));
    await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));
    duplicate.send(JSON.stringify(envelope));
    await closeSocket(duplicate);
    releaseTrigger();
    await collectUntil(ownerInbox, (message) => message.type === "command-result");
    await server.close();
    server = undefined;

    expect(executed).toEqual([
      { type: "trigger-sample-pad", pad: 4, velocity: 100 },
      { type: "release-sample-pad", pad: 4 },
    ]);
    owner.terminate();
  });

  it("does not release a pad twice after a normal sample release", async () => {
    engine = new SimulatedHostEngine();
    const executed: string[] = [];
    const executeCommand = vi.fn(async (command) => {
      executed.push(command.type);
      const snapshot = engine!.snapshot();
      return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "36f93c0b-dfc5-40cf-8c78-7d9ab41be662", command: { type: "trigger-sample-pad", pad: 6, velocity: 100 } }));
    await collectUntil(inbox, (message) => message.type === "command-result");
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "3acbd3da-a56d-4d96-91aa-6d2e7423917c", command: { type: "release-sample-pad", pad: 6 } }));
    await collectUntil(inbox, (message) => message.type === "command-result");
    await closeSocket(socket);
    await server.close();
    server = undefined;

    expect(executed).toEqual(["trigger-sample-pad", "release-sample-pad"]);
  });

  it("waits for held-sample cleanup when the server itself closes", async () => {
    engine = new SimulatedHostEngine();
    const cleanupStarted = deferred<void>();
    let finishCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => { finishCleanup = resolve; });
    const executed: string[] = [];
    const executeCommand = vi.fn(async (command) => {
      executed.push(command.type);
      if (command.type === "release-sample-pad") {
        cleanupStarted.resolve();
        await cleanupGate;
      }
      const snapshot = engine!.snapshot();
      return { accepted: true, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle };
    });
    server = await createControlServer(engine, 0, undefined, executeCommand);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/control`);
    const inbox = new MessageInbox(socket);
    await inbox.next();
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "cdf6c890-7648-4213-b0df-91f510d488e8", command: { type: "trigger-sample-pad", pad: 1, velocity: 100 } }));
    await collectUntil(inbox, (message) => message.type === "command-result");

    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    await cleanupStarted.promise;
    expect(closed).toBe(false);
    finishCleanup();
    await closing;
    server = undefined;

    expect(closed).toBe(true);
    expect(executed).toEqual(["trigger-sample-pad", "release-sample-pad"]);
  });

  it.each(["export-mp3", "export-loop-sample"] as const)("does not hold Stop behind a long-running %s", async (exportType) => {
    engine = new SimulatedHostEngine();
    let releaseExport!: () => void;
    const exportGate = new Promise<void>((resolve) => { releaseExport = resolve; });
    const executeCommand = vi.fn(async (command) => {
      if (command.type === "export-mp3" || command.type === "export-loop-sample") {
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

    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: "2030495e-26db-46d2-8283-8f01c3310fac", command: { type: exportType, name: "Session" } }));
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function closeSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}
