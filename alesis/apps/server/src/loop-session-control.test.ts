import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { SilentAudioOutput } from "@alesis/audio";
import { SimulatedHostEngine } from "@alesis/engine";
import { LOOP_SESSION_MAX_BYTES, PROTOCOL_VERSION, serverMessageSchema, type EngineCommand, type ServerMessage } from "@alesis/protocol";
import { createControlServer, type ControlServer } from "./control-server.js";
import { MidiLoopScheduler } from "./loop-playback.js";
import { exportLoopSession, importLoopSession, type LoopSessionHost } from "./loop-session.js";

let server: ControlServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

async function fixture() {
  const engine = new SimulatedHostEngine();
  const loops = new MidiLoopScheduler(new SilentAudioOutput());
  await engine.execute({ type: "configure", settings: { countInEnabled: false, bpm: 120, beatsPerMeasure: 1, loopMeasures: 1 } });
  await engine.execute({ type: "play" });
  loops.record({ type: "note-on", channel: 0, note: 60, velocity: 100 }, engine.snapshot());
  engine.advance(0.5);
  loops.update(engine.snapshot());
  await engine.execute({ type: "stop" });
  loops.update(engine.snapshot());
  const prepareAudio = vi.fn(async () => ({ commit() {}, async dispose() {} }));
  const host: LoopSessionHost = { engine, loops, prepareAudio, percussionSoundFontId: null, inspectPresets: () => [] };
  const json = exportLoopSession(host).sessionJson!;
  const execute = vi.fn(async (command: EngineCommand) => {
    if (command.type === "export-loop-session") return exportLoopSession(host);
    if (command.type === "import-loop-session") return importLoopSession(command.sessionJson, host);
    return engine.execute(command);
  });
  server = await createControlServer(engine, 0, undefined, execute);
  return { engine, loops, host, prepareAudio, execute, json };
}

async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${server!.port}/control`);
  const messages: ServerMessage[] = [];
  const waiters = new Map<string, (result: Result) => void>();
  socket.on("message", (raw) => {
    const message = serverMessageSchema.parse(JSON.parse(raw.toString()));
    messages.push(message);
    if (message.type === "command-result") waiters.get(message.commandId)?.(message);
  });
  await new Promise<void>((resolve) => socket.once("open", resolve));
  function send(command: EngineCommand, commandId = randomUUID()): Promise<Result> {
    const result = new Promise<Result>((resolve) => waiters.set(commandId, resolve));
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId, command }));
    return result;
  }
  return { socket, messages, send };
}
type Result = Extract<ServerMessage, { type: "command-result" }>;

describe("loop-session control queue", () => {
  it("bounds queued session payloads and recovers once transfers finish", async () => {
    const { json, prepareAudio } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    prepareAudio.mockImplementationOnce(async () => { await gate; return { commit() {}, async dispose() {} }; });
    const client = await connect();
    const pending = Array.from({ length: 4 }, () => client.send({ type: "import-loop-session", sessionJson: json }));
    try {
      const rejected = await client.send({ type: "import-loop-session", sessionJson: json });
      expect(rejected).toMatchObject({ accepted: false, error: expect.stringContaining("Too many pending") });
      expect(client.socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      release();
    }
    expect((await Promise.all(pending)).every(({ accepted }) => accepted)).toBe(true);
    expect((await client.send({ type: "export-loop-session" })).accepted).toBe(true);
  });

  it("rejects malformed/oversized files recoverably and never mutates the existing session", async () => {
    const { engine, json, prepareAudio } = await fixture();
    const client = await connect();
    const before = engine.snapshot();
    for (const sessionJson of ["{", "{}", JSON.stringify({ ...JSON.parse(json), version: 99 }), " ".repeat(LOOP_SESSION_MAX_BYTES + 1)]) {
      const result = await client.send({ type: "import-loop-session", sessionJson });
      expect(result.accepted).toBe(false);
      expect(result.error).toBeTruthy();
      expect(engine.snapshot()).toEqual(before);
      expect(client.socket.readyState).toBe(WebSocket.OPEN);
    }
    expect(prepareAudio).not.toHaveBeenCalled();
    expect((await client.send({ type: "import-loop-session", sessionJson: json })).accepted).toBe(true);
  });

  it("delivers download data only to the requester and does not keep large responses in the retry cache", async () => {
    const { json, execute } = await fixture();
    const owner = await connect();
    const observer = await connect();
    const id = randomUUID();
    expect(await owner.send({ type: "export-loop-session" }, id)).toMatchObject({ accepted: true, sessionJson: json });
    await observer.send({ type: "configure", settings: {} });
    expect(observer.messages.some((message) => "sessionJson" in message)).toBe(false);
    const retry = await owner.send({ type: "export-loop-session" }, id);
    expect(retry).toMatchObject({ accepted: false, error: expect.stringContaining("already sent") });
    expect(retry.sessionJson).toBeUndefined();
    expect(execute.mock.calls.filter(([command]) => command.type === "export-loop-session")).toHaveLength(1);
    // Another client's command ID cannot resolve to the first client's cached/in-flight result.
    expect((await observer.send({ type: "export-loop-session" }, id)).sessionJson).toBe(json);
    expect(execute.mock.calls.filter(([command]) => command.type === "export-loop-session")).toHaveLength(2);
  });

  it("evaluates stopped requirements inside receive order, including host-submitted play/stop", async () => {
    const { engine, json, prepareAudio } = await fixture();
    const client = await connect();
    await server!.submit({ type: "play" });
    expect((await client.send({ type: "export-loop-session" })).accepted).toBe(false);
    expect((await client.send({ type: "import-loop-session", sessionJson: json })).accepted).toBe(false);
    expect(prepareAudio).not.toHaveBeenCalled();
    const stop = client.send({ type: "stop" });
    const load = client.send({ type: "import-loop-session", sessionJson: json });
    expect((await stop).accepted).toBe(true);
    expect((await load).accepted).toBe(true);
    expect(engine.snapshot().transport.state).toBe("stopped");
    const play = client.send({ type: "play" });
    const rejected = client.send({ type: "import-loop-session", sessionJson: json });
    await play;
    expect(await rejected).toMatchObject({ accepted: false, error: expect.stringContaining("Stop transport") });
  });

  it("keeps queued play/export and live MIDI capture outside async import preparation", async () => {
    const { engine, loops, json, prepareAudio, execute } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    prepareAudio.mockImplementationOnce(async () => { await gate; return { commit() {}, async dispose() {} }; });
    const owner = await connect();
    const load = owner.send({ type: "import-loop-session", sessionJson: json });
    await vi.waitFor(() => expect(prepareAudio).toHaveBeenCalledOnce());
    const save = server!.submit({ type: "export-loop-session" });
    const play = server!.submit({ type: "play" });
    loops.record({ type: "note-on", channel: 0, note: 99, velocity: 100 }, engine.snapshot());
    engine.advance(10);
    expect(loops.hasCurrentRecording()).toBe(false);
    expect(engine.snapshot().transport.state).toBe("stopped");
    expect(execute.mock.calls.map(([command]) => command.type)).toEqual(["import-loop-session"]);
    release();
    expect((await load).accepted).toBe(true);
    const saved = await save;
    expect(saved.sessionJson).not.toContain('"note":99');
    expect(saved.accepted).toBe(true);
    expect((await play).accepted).toBe(true);
    expect(execute.mock.calls.map(([command]) => command.type)).toEqual(["import-loop-session", "export-loop-session", "play"]);
  });
});
