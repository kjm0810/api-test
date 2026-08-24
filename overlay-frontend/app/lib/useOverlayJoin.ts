"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://5.104.82.219:3000";

export function useOverlayJoin(token: string | undefined) {
  const [state, setState] = useState<"연결 중" | "연결됨" | "오류">("연결 중");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<unknown>({});
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    document.body.classList.add("overlay-mode");
    return () => { document.body.classList.remove("overlay-mode"); };
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(`${API}/overlay`, { transports: ["websocket"], timeout: 5000 });
    socketRef.current = socket;
    socket.on("connect", () => socket.emit("join", token));
    socket.on("joined", (data: { settings?: unknown }) => {
      setState("연결됨");
      setSettings(data.settings ?? {});
    });
    socket.on("join_error", (data: { error: string }) => { setState("오류"); setError(data.error); });
    socket.on("connect_error", (err) => { setState("오류"); setError(err.message); });
    return () => { socket.disconnect(); };
  }, [token]);

  return { state, error, settings, socketRef };
}
