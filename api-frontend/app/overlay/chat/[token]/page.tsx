"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { decodeEvent } from "../../../lib/decode";
import { useOverlayJoin } from "../../../lib/useOverlayJoin";

type Platform = "soop" | "chzzk";
type StreamEvent = { _id: string; platform: Platform; nickname: string; message: string };

type ChatSettings = { maxMessages: number; fontSize: number };

function normalizeChatSettings(input: Partial<ChatSettings> | undefined | null): ChatSettings {
  return { maxMessages: 30, fontSize: 16, ...input };
}

export default function ChatOverlayPage() {
  const params = useParams<{ token: string }>();
  const { state, error, settings: rawSettings, socketRef } = useOverlayJoin(params.token);
  const settings = normalizeChatSettings(rawSettings as Partial<ChatSettings>);
  const [messages, setMessages] = useState<StreamEvent[]>([]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onChat = (payload: ArrayBuffer) => {
      try {
        const event = decodeEvent<StreamEvent>(payload);
        setMessages((list) => [event, ...list].slice(0, settings.maxMessages));
      } catch { /* 압축 해제 실패한 이벤트는 무시 */ }
    };
    socket.on("chat", onChat);
    return () => { socket.off("chat", onChat); };
  }, [socketRef, settings.maxMessages]);

  return (
    <div className="overlay-page">
      {(error || state !== "연결됨") && (
        <div className="overlay-topbar"><span className={`status ${state === "연결됨" ? "online" : ""}`}>{state}</span></div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="overlay-feed" style={{ fontSize: settings.fontSize }}>
        {messages.map((message) => (
          <div key={message._id} className="overlay-card">
            <span className={`badge ${message.platform}`}>{message.platform.toUpperCase()}</span>
            <strong>{message.nickname || "익명"}</strong>
            <span>{message.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
