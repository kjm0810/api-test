"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { decodeEvent } from "../../lib/decode";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://5.104.82.219:3000";

type Platform = "soop" | "chzzk";
type StreamEvent = {
  _id: string; platform: Platform; type: "chat" | "donation";
  streamer_id: string; streamer_nickname: string;
  user_id: string; nickname: string; message: string;
  cnt?: number; amount?: number;
};

export default function OverlayTokenPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [state, setState] = useState<"연결 중" | "연결됨" | "오류">("연결 중");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    document.body.classList.add("overlay-mode");
    return () => { document.body.classList.remove("overlay-mode"); };
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(`${API}/overlay`, { transports: ["websocket"], timeout: 5000 });
    socket.on("connect", () => socket.emit("join", token));
    socket.on("joined", () => setState("연결됨"));
    socket.on("join_error", (data: { error: string }) => { setState("오류"); setError(data.error); });
    socket.on("connect_error", (err) => { setState("오류"); setError(err.message); });
    const onEvent = (payload: ArrayBuffer) => {
      try { setEvents((current) => [decodeEvent<StreamEvent>(payload), ...current].slice(0, 30)); }
      catch { /* 압축 해제 실패한 이벤트는 무시 */ }
    };
    socket.on("chat", onEvent);
    socket.on("donation", onEvent);
    return () => { socket.disconnect(); };
  }, [token]);

  return (
    <div className="overlay-page">
      {(error || state !== "연결됨") && (
        <div className="overlay-topbar">
          <span className={`status ${state === "연결됨" ? "online" : ""}`}>{state}</span>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="overlay-feed">
        {events.map((item) => (
          <div key={item._id} className={`overlay-card ${item.type}`}>
            <span className={`badge ${item.platform}`}>{item.platform.toUpperCase()}</span>
            <strong>{item.nickname || "익명"}</strong>
            {item.type === "donation"
              ? <span>{Number(item.amount ?? 0).toLocaleString()}원 후원{item.message && ` · ${item.message}`}</span>
              : <span>{item.message}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
