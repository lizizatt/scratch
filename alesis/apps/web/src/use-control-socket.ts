import { useEffect, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type EngineCommand,
  type EngineSnapshot,
  type Readiness,
  type ServerMessage,
} from "@alesis/protocol";

export type ConnectionState = "connecting" | "connected" | "disconnected";
type CommandResult = Extract<ServerMessage, { type: "command-result" }>;
type CommandResultHandler = (result: CommandResult | null) => void;

export function useControlSocket(): {
  snapshot: EngineSnapshot | null;
  readiness: Readiness | null;
  connection: ConnectionState;
  lastError: string | null;
  lastMessage: string | null;
  send: (command: EngineCommand, onResult?: CommandResultHandler) => string | null;
} {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingResultsRef = useRef(new Map<string, CommandResultHandler>());

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;
    let retry = 0;

    const connect = (): void => {
      if (disposed) return;
      setConnection("connecting");
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${scheme}://${location.host}/control`);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        retry = 0;
        setConnection("connected");
        setLastError(null);
      });
      socket.addEventListener("message", (event) => {
        const parsed = serverMessageSchema.safeParse(JSON.parse(String(event.data)));
        if (!parsed.success) {
          setLastError("Host sent an incompatible message");
          return;
        }
        if (parsed.data.type === "snapshot") {
          setSnapshot(parsed.data.snapshot);
          setReadiness(parsed.data.readiness);
        }
        if (parsed.data.type === "snapshot-update") {
          const update = parsed.data.update;
          setSnapshot((current) => current ? { ...current, ...update } : current);
          setReadiness(parsed.data.readiness);
        }
        if (parsed.data.type === "command-result") {
          const handler = pendingResultsRef.current.get(parsed.data.commandId);
          if (handler) {
            pendingResultsRef.current.delete(parsed.data.commandId);
            handler(parsed.data);
          }
          if (!parsed.data.accepted) setLastError(parsed.data.error ?? "Command rejected");
          if (parsed.data.accepted && parsed.data.message) setLastMessage(parsed.data.message);
        }
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        for (const [commandId, handler] of pendingResultsRef.current) {
          pendingResultsRef.current.delete(commandId);
          handler(null);
        }
        if (disposed) return;
        setConnection("disconnected");
        retry += 1;
        reconnectTimer = window.setTimeout(connect, Math.min(5_000, 250 * 2 ** retry));
      });
      socket.addEventListener("error", () => socket.close());
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  const send = (command: EngineCommand, onResult?: CommandResultHandler): string | null => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setLastError("Host is not connected");
      return null;
    }
    const commandId = crypto.randomUUID();
    if (onResult) pendingResultsRef.current.set(commandId, onResult);
    setLastError(null);
    setLastMessage(null);
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId, command }));
    return commandId;
  };

  return { snapshot, readiness, connection, lastError, lastMessage, send };
}
