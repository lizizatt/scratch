import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { EngineResult, HostEngine } from "@alesis/engine";
import {
  commandEnvelopeSchema,
  LOOP_SESSION_MAX_BYTES,
  type CommandEnvelope,
  type EngineCommand,
  type Readiness,
  type ServerMessage,
} from "@alesis/protocol";
import { WebSocket, WebSocketServer } from "ws";
import sirv from "sirv";

export interface ControlServer {
  readonly port: number;
  submit(command: EngineCommand): Promise<EngineResult>;
  submit(commandFactory: () => EngineCommand | null): Promise<EngineResult | null>;
  invalidateSamplePadHolds(): void;
  close(): Promise<void>;
}

interface ConnectionState {
  heldSamplePads: Set<number>;
  cleanup: Promise<void> | null;
}

const readyForDevelopment: Readiness = {
  soundFont: { ready: true },
  synth: { ready: true },
  audio: { ready: true },
  midi: { ready: true },
};

export async function createControlServer(
  engine: HostEngine,
  port = 0,
  staticDirectory?: string,
  executeCommand: (command: EngineCommand) => Promise<EngineResult> = (command) => engine.execute(command),
  host = "127.0.0.1",
  readiness: Readiness = readyForDevelopment,
): Promise<ControlServer> {
  const httpServer = createHttpServer(staticDirectory, readiness);
  const webSocketServer = new WebSocketServer({ server: httpServer, path: "/control", maxPayload: LOOP_SESSION_MAX_BYTES * 6 + 1024 });
  const results = new Map<string, ServerMessage>();
  const inFlight = new Map<string, Promise<ServerMessage>>();
  const connections = new Set<ConnectionState>();
  let pendingSessionCommands = 0;
  let commandTail = Promise.resolve();
  const enqueueCommand = <T>(execute: () => Promise<T>): Promise<T> => {
    const pending = commandTail.then(execute, execute);
    commandTail = pending.then(() => undefined, () => undefined);
    return pending;
  };
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotPending = false;
  let latestSnapshot = engine.snapshot();
  let sampleHoldGeneration = 0;
  let previousPadResetState = {
    mode: latestSnapshot.pads.mode,
    samplePageIndex: latestSnapshot.pads.samplePageIndex,
    sampleLibraryStatus: latestSnapshot.pads.sampleLibraryStatus,
  };

  const invalidateSamplePadHolds = (): void => {
    sampleHoldGeneration += 1;
    for (const connection of connections) connection.heldSamplePads.clear();
  };

  const broadcastSnapshotNow = (): void => {
    const payload = JSON.stringify({ type: "snapshot", snapshot: engine.snapshot(), readiness } satisfies ServerMessage);
    webSocketServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  };
  const broadcastSnapshotUpdateNow = (): void => {
    const { revision, engine: engineState, transport, capture, synth, pads } = latestSnapshot;
    const payload = JSON.stringify({
      type: "snapshot-update",
      update: { revision, engine: engineState, transport, capture, synth, pads },
      readiness,
    } satisfies ServerMessage);
    webSocketServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  };
  const scheduleSnapshot = (snapshot: ReturnType<HostEngine["snapshot"]>): void => {
    latestSnapshot = snapshot;
    snapshotPending = true;
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = undefined;
      if (!snapshotPending) return;
      snapshotPending = false;
      broadcastSnapshotUpdateNow();
    }, 1000 / 30);
  };
  const unsubscribe = engine.subscribe((snapshot) => {
    const pads = snapshot.pads;
    if (
      pads.mode !== previousPadResetState.mode
      || pads.samplePageIndex !== previousPadResetState.samplePageIndex
      || (pads.sampleLibraryStatus === "loading" && previousPadResetState.sampleLibraryStatus !== "loading")
    ) invalidateSamplePadHolds();
    previousPadResetState = {
      mode: pads.mode,
      samplePageIndex: pads.samplePageIndex,
      sampleLibraryStatus: pads.sampleLibraryStatus,
    };
    scheduleSnapshot(snapshot);
  });

  webSocketServer.on("connection", (socket) => {
    const connectionId = randomUUID();
    socket.on("error", () => { /* Payload-limit/protocol errors close only this connection. */ });
    const connection: ConnectionState = { heldSamplePads: new Set<number>(), cleanup: null };
    connections.add(connection);
    socket.send(JSON.stringify({ type: "snapshot", snapshot: engine.snapshot(), readiness } satisfies ServerMessage));
    socket.on("message", async (data) => {
      const envelope = parseEnvelope(data.toString());
      if (!envelope) {
        socket.close(1008, "Invalid control message");
        return;
      }

      const sessionCommand = envelope.command.type === "export-loop-session" || envelope.command.type === "import-loop-session";
      const resultKey = sessionCommand ? `${connectionId}:${envelope.commandId}` : envelope.commandId;
      const cached = results.get(resultKey);
      if (cached) {
        socket.send(JSON.stringify(cached));
        return;
      }

      let pending = inFlight.get(resultKey);
      if (!pending) {
        if (sessionCommand && pendingSessionCommands >= 4) {
          const snapshot = engine.snapshot();
          socket.send(JSON.stringify(commandResult(envelope, {
            accepted: false, revision: snapshot.revision, appliedCycle: snapshot.transport.cycle,
            error: "Too many pending loop-session transfers; wait and retry",
          })));
          return;
        }
        if (sessionCommand) pendingSessionCommands += 1;
        const execute = async () => {
          const holdGeneration = sampleHoldGeneration;
          const message = await executeEnvelope(envelope, engine, executeTrackedCommand, readiness);
          if (message.type === "command-result" && message.accepted) {
            if (envelope.command.type === "trigger-sample-pad" && holdGeneration === sampleHoldGeneration) {
              connection.heldSamplePads.add(envelope.command.pad);
            }
            if (envelope.command.type === "release-sample-pad") connection.heldSamplePads.delete(envelope.command.pad);
          }
          return message;
        };
        if (envelope.command.type === "export-mp3" || envelope.command.type === "export-loop-sample") {
          pending = commandTail.then(execute, execute);
        } else {
          pending = enqueueCommand(execute);
        }
        inFlight.set(resultKey, pending);
        void pending.then((message) => {
          const cachedMessage: ServerMessage = message.type === "command-result" && message.sessionJson !== undefined
            ? { type: "command-result", commandId: message.commandId, revision: message.revision, appliedCycle: message.appliedCycle, accepted: false, error: "Session download already sent. Save again to download a new copy." }
            : message;
          results.set(resultKey, cachedMessage);
          if (results.size > 512) results.delete(results.keys().next().value!);
        }).finally(() => {
          inFlight.delete(resultKey);
          if (sessionCommand) pendingSessionCommands -= 1;
        });
      }
      const message = await pending;
      snapshotPending = false;
      broadcastSnapshotNow();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    });
    socket.on("close", () => {
      void queueConnectionCleanup(connection);
    });
  });

  const executeTrackedCommand = async (command: EngineCommand): Promise<EngineResult> => {
    const before = engine.snapshot();
    if ((command.type === "import-loop-session" || command.type === "export-loop-session") && before.transport.state !== "stopped") {
      return { accepted: false, revision: before.revision, appliedCycle: before.transport.cycle, error: "Stop transport before saving or loading a loop session" };
    }
    const result = await executeCommand(command);
    if (result.accepted) {
      const after = engine.snapshot();
      const samplePageNavigation = (command.type === "select-pad-program" || command.type === "step-pad-navigation")
        && before.pads.navigationTarget === "sample-pages"
        && (
          before.pads.samplePageIndex !== after.pads.samplePageIndex
          || (before.pads.sampleLibraryStatus !== "loading" && after.pads.sampleLibraryStatus === "loading")
        );
      if (
        command.type === "refresh-samples"
        || (command.type === "set-pad-mode" && before.pads.mode !== after.pads.mode)
        || samplePageNavigation
      ) invalidateSamplePadHolds();
    }
    return result;
  };

  const queueConnectionCleanup = (connection: ConnectionState): Promise<void> => {
    if (connection.cleanup) return connection.cleanup;
    connection.cleanup = enqueueCommand(async () => {
      const pads = [...connection.heldSamplePads];
      connection.heldSamplePads.clear();
      for (const pad of pads) {
        try {
          await executeCommand({ type: "release-sample-pad", pad });
        } catch {
          // Continue releasing other pads even if one cleanup command fails.
        }
      }
    });
    void connection.cleanup.then(() => connections.delete(connection), () => connections.delete(connection));
    return connection.cleanup;
  };

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, resolve);
  });

  function submit(command: EngineCommand): Promise<EngineResult>;
  function submit(commandFactory: () => EngineCommand | null): Promise<EngineResult | null>;
  function submit(commandOrFactory: EngineCommand | (() => EngineCommand | null)): Promise<EngineResult | null> {
    if (typeof commandOrFactory === "function") {
      return enqueueCommand(async () => {
        const command = commandOrFactory();
        return command ? executeTrackedCommand(command) : null;
      });
    }
    const execute = () => executeTrackedCommand(commandOrFactory);
    return commandOrFactory.type === "export-mp3" || commandOrFactory.type === "export-loop-sample"
      ? commandTail.then(execute, execute)
      : enqueueCommand(execute);
  }

  return {
    port: (httpServer.address() as AddressInfo).port,
    submit,
    invalidateSamplePadHolds,
    async close() {
      unsubscribe();
      if (snapshotTimer) clearTimeout(snapshotTimer);
      const connectionCleanups = [...connections].map(queueConnectionCleanup);
      for (const client of webSocketServer.clients) client.terminate();
      await closeWebSocketServer(webSocketServer);
      await Promise.all(connectionCleanups);
      await commandTail;
      await closeHttpServer(httpServer);
    },
  };
}

async function executeEnvelope(
  envelope: CommandEnvelope,
  engine: HostEngine,
  executeCommand: (command: EngineCommand) => Promise<EngineResult>,
  readiness: Readiness,
): Promise<ServerMessage> {
  const snapshot = engine.snapshot();
  const notReady = envelope.command.type === "play" ? readinessFailure(readiness) : null;
  if (notReady) {
    return commandResult(envelope, {
      accepted: false,
      revision: snapshot.revision,
      appliedCycle: snapshot.transport.cycle,
      error: notReady,
    });
  }
  try {
    return commandResult(envelope, await executeCommand(envelope.command));
  } catch (error) {
    const current = engine.snapshot();
    return commandResult(envelope, {
      accepted: false,
      revision: current.revision,
      appliedCycle: current.transport.cycle,
      error: `Command failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function createHttpServer(staticDirectory: string | undefined, readiness: Readiness): HttpServer {
  const serveStatic = staticDirectory ? sirv(staticDirectory, { single: true, dev: true }) : undefined;
  return createServer((request, response) => {
    if (request.url === "/health") {
      const ready = Object.values(readiness).every((dependency) => dependency.ready);
      response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: ready ? "ready" : "not-ready", dependencies: readiness }));
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

function readinessFailure(readiness: Readiness): string | null {
  const failures = Object.entries(readiness)
    .filter(([, dependency]) => !dependency.ready)
    .map(([name, dependency]) => `${name}: ${dependency.reason ?? "Unavailable"}`);
  return failures.length > 0 ? `Not Ready: ${failures.join("; ")}` : null;
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
    ...(result.sessionJson === undefined ? {} : { sessionJson: result.sessionJson }),
  };
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
