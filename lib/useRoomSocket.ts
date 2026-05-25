"use client";

import { useEffect, useRef, useState } from "react";
import type { ClientMessage, RoomState } from "../worker/protocol";

type Params = {
  code: string;
  role: "host" | "participant";
  participantId?: string;
  name?: string;
  enabled?: boolean;
};

type ServerMessage =
  | { type: "state"; state: RoomState; serverNow: number }
  | { type: "error"; message: string };

export type RoomSocket = {
  state: RoomState | null;
  status: "connecting" | "open" | "closed";
  error: string | null;
  clockSkewMs: number;
  send: (msg: ClientMessage) => void;
};

export function useRoomSocket({
  code,
  role,
  participantId,
  name,
  enabled = true,
}: Params): RoomSocket {
  const [state, setState] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [error, setError] = useState<string | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef(0);
  const closedManually = useRef(false);

  useEffect(() => {
    if (!enabled || !code) return;
    closedManually.current = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const params = new URLSearchParams({ role });
      if (role === "participant") {
        if (!participantId || !name) return;
        params.set("id", participantId);
        params.set("name", name);
      }
      const url = `${proto}://${location.host}/ws/${code}?${params.toString()}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        setStatus("open");
        setError(null);
        reconnectRef.current = 0;
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as ServerMessage;
          if (msg.type === "state") {
            setState(msg.state);
            setClockSkewMs(msg.serverNow - Date.now());
          } else if (msg.type === "error") {
            setError(msg.message);
          }
        } catch {}
      };
      ws.onclose = () => {
        setStatus("closed");
        wsRef.current = null;
        if (closedManually.current) return;
        const delay = Math.min(5000, 500 * 2 ** reconnectRef.current);
        reconnectRef.current++;
        if (reconnectRef.current <= 6) {
          setTimeout(connect, delay);
        }
      };
      ws.onerror = () => {
        setError("connection error");
      };
    };

    connect();

    return () => {
      closedManually.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [code, role, participantId, name, enabled]);

  const send = (msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  return { state, status, error, clockSkewMs, send };
}
