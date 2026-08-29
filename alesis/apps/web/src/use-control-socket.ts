import { useEffect, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type EngineCommand,
  type EngineSnapshot,
} from "@alesis/protocol";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export function useControlSocket(): {
  snapshot: EngineSnapshot | null;
  connection: ConnectionState;
  lastError: string | null;
  send: (command: EngineCommand) => string | null;
} {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

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
        if (parsed.data.type === "snapshot") setSnapshot(parsed.data.snapshot);
        if (parsed.data.type === "command-result" && !parsed.data.accepted) setLastError(parsed.data.error ?? "Command rejected");
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
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

  const send = (command: EngineCommand): string | null => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setLastError("Host is not connected");
      return null;
    }
    const commandId = crypto.randomUUID();
    socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId, command }));
    return commandId;
  };

  return { snapshot, connection, lastError, send };
}
