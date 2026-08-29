import { afterEach, describe, expect, it } from "vitest";
import { SimulatedHostEngine } from "@alesis/engine";
import { PROTOCOL_VERSION, serverMessageSchema, type ServerMessage } from "@alesis/protocol";
import WebSocket from "ws";
import { createControlServer, type ControlServer } from "./control-server.js";

let server: ControlServer | undefined;
let engine: SimulatedHostEngine | undefined;

afterEach(async () => {
  await server?.close();
  await engine?.dispose();
  server = undefined;
  engine = undefined;
});

describe("control server", () => {
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
