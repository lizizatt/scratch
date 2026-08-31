import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { EngineResult, HostEngine } from "@alesis/engine";
import {
  commandEnvelopeSchema,
  type CommandEnvelope,
  type EngineCommand,
  type ServerMessage,
} from "@alesis/protocol";
import { WebSocket, WebSocketServer } from "ws";
import sirv from "sirv";

export interface ControlServer {
  readonly port: number;
  close(): Promise<void>;
}

export async function createControlServer(
  engine: HostEngine,
  port = 0,
  staticDirectory?: string,
  executeCommand: (command: EngineCommand) => Promise<EngineResult> = (command) => engine.execute(command),
  host = "127.0.0.1",
): Promise<ControlServer> {
  const httpServer = createHttpServer(staticDirectory);
  const webSocketServer = new WebSocketServer({ server: httpServer, path: "/control" });
  const results = new Map<string, ServerMessage>();
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotPending = false;

  const broadcastSnapshotNow = (): void => {
    const payload = JSON.stringify({ type: "snapshot", snapshot: engine.snapshot() } satisfies ServerMessage);
    webSocketServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  };
  const scheduleSnapshot = (): void => {
    snapshotPending = true;
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = undefined;
      if (!snapshotPending) return;
      snapshotPending = false;
      broadcastSnapshotNow();
    }, 1000 / 30);
  };
  const unsubscribe = engine.subscribe(scheduleSnapshot);

  webSocketServer.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "snapshot", snapshot: engine.snapshot() } satisfies ServerMessage));
    socket.on("message", async (data) => {
      const envelope = parseEnvelope(data.toString());
      if (!envelope) {
        socket.close(1008, "Invalid control message");
        return;
      }

      const cached = results.get(envelope.commandId);
      if (cached) {
        socket.send(JSON.stringify(cached));
        return;
      }

      const result = await executeCommand(envelope.command);
      snapshotPending = false;
      broadcastSnapshotNow();
      const message = commandResult(envelope, result);
      results.set(envelope.commandId, message);
      if (results.size > 512) results.delete(results.keys().next().value!);
      socket.send(JSON.stringify(message));
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, resolve);
  });

  return {
    port: (httpServer.address() as AddressInfo).port,
    async close() {
      unsubscribe();
      if (snapshotTimer) clearTimeout(snapshotTimer);
      for (const client of webSocketServer.clients) client.terminate();
      await closeWebSocketServer(webSocketServer);
      await closeHttpServer(httpServer);
    },
  };
}

function createHttpServer(staticDirectory?: string): HttpServer {
  const serveStatic = staticDirectory ? sirv(staticDirectory, { single: true, dev: true }) : undefined;
  return createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (serveStatic) {
      serveStatic(request, response, () => {
        response.writeHead(404).end();
      });
      return;
    }
    response.writeHead(404).end();
  });
}

function parseEnvelope(raw: string): CommandEnvelope | null {
  try {
    return commandEnvelopeSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function commandResult(envelope: CommandEnvelope, result: EngineResult): ServerMessage {
  const base = {
    type: "command-result" as const,
    commandId: envelope.commandId,
    accepted: result.accepted,
    revision: result.revision,
    appliedCycle: result.appliedCycle,
  };
  return {
    ...base,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.message === undefined ? {} : { message: result.message }),
  };
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
