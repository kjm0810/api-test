"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { decodeEvent } from "../../lib/decode";
import {
  isDonationTypeEnabled, normalizeChatSettings, normalizeGameSettings, normalizeOverlaySettings,
  pickTier, renderTemplate, type ChatSettings, type GameSettings, type OverlaySettings, type WidgetType,
} from "../../lib/overlaySettings";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://5.104.82.219:3000";

type Platform = "soop" | "chzzk";
type StreamEvent = {
  _id: string; platform: Platform; type: "chat" | "donation";
  streamer_id: string; streamer_nickname: string;
  user_id: string; nickname: string; message: string;
  cnt?: number; amount?: number; extras?: unknown;
};

function useOverlaySocket(token: string | undefined) {
  const [state, setState] = useState<"연결 중" | "연결됨" | "오류">("연결 중");
  const [error, setError] = useState("");
  const [widgetType, setWidgetType] = useState<WidgetType | null>(null);
  const [rawSettings, setRawSettings] = useState<unknown>({});
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
    socket.on("joined", (data: { type: WidgetType; settings?: unknown }) => {
      setState("연결됨");
      setWidgetType(data.type);
      setRawSettings(data.settings ?? {});
    });
    socket.on("join_error", (data: { error: string }) => { setState("오류"); setError(data.error); });
    socket.on("connect_error", (err) => { setState("오류"); setError(err.message); });
    return () => { socket.disconnect(); };
  }, [token]);

  return { state, error, widgetType, rawSettings, socketRef };
}

export default function OverlayTokenPage() {
  const params = useParams<{ token: string }>();
  const { state, error, widgetType, rawSettings, socketRef } = useOverlaySocket(params.token);

  return (
    <div className="overlay-page">
      {(error || state !== "연결됨") && (
        <div className="overlay-topbar"><span className={`status ${state === "연결됨" ? "online" : ""}`}>{state}</span></div>
      )}
      {error && <div className="error">{error}</div>}
      {widgetType === "donation" && <DonationWidget socketRef={socketRef} settings={normalizeOverlaySettings(rawSettings as Partial<OverlaySettings>)} />}
      {widgetType === "chat" && <ChatWidget socketRef={socketRef} settings={normalizeChatSettings(rawSettings as Partial<ChatSettings>)} />}
      {widgetType === "game" && <GameWidget socketRef={socketRef} settings={normalizeGameSettings(rawSettings as Partial<GameSettings>)} />}
    </div>
  );
}

type SocketRef = React.MutableRefObject<Socket | null>;

function DonationWidget({ socketRef, settings }: { socketRef: SocketRef; settings: OverlaySettings }) {
  const [alerts, setAlerts] = useState<{ id: string; text: string; image: string; platform: Platform }[]>([]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onDonation = (payload: ArrayBuffer) => {
      try {
        const event = decodeEvent<StreamEvent>(payload);
        if (!isDonationTypeEnabled(settings, event)) return;
        const cnt = event.cnt ?? 0;
        const amount = event.amount ?? 0;
        const tier = pickTier(settings, cnt);
        const text = renderTemplate(tier?.text ?? settings.defaultText, { nickname: event.nickname || "익명", cnt, amount, message: event.message });
        setAlerts((list) => [{ id: event._id, text, image: tier?.image ?? "", platform: event.platform }, ...list].slice(0, 20));
        if (settings.ttsEnabled && "speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = "ko-KR";
          window.speechSynthesis.speak(utterance);
        }
      } catch { /* 압축 해제/파싱 실패한 이벤트는 무시 */ }
    };
    socket.on("donation", onDonation);
    return () => { socket.off("donation", onDonation); };
  }, [socketRef, settings]);

  return (
    <div className={`theme-${settings.theme}`} style={{ opacity: settings.transparency / 100 }}>
      <div className="overlay-feed">
        {alerts.map((alert) => (
          <div key={alert.id} className={`overlay-card donation badge ${alert.platform}`}>
            {alert.image && <img src={alert.image} alt="" className="overlay-alert-image" />}
            <span>{alert.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatWidget({ socketRef, settings }: { socketRef: SocketRef; settings: ChatSettings }) {
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
    <div className={`theme-${settings.theme}`}>
      <div className="overlay-feed">
        {messages.map((message) => (
          <div key={message._id} className={`overlay-card badge ${message.platform}`}>
            <strong>{message.nickname || "익명"}</strong>
            <span>{message.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GameWidget({ socketRef, settings }: { socketRef: SocketRef; settings: GameSettings }) {
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState("");

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onDonation = (payload: ArrayBuffer) => {
      try {
        const event = decodeEvent<StreamEvent>(payload);
        const cnt = event.cnt ?? 0;
        if (cnt < settings.triggerMinCnt) return;
        setWinner(event.nickname || "익명");
        setSpinning(true);
        setTimeout(() => setSpinning(false), 2500);
      } catch { /* 압축 해제 실패한 이벤트는 무시 */ }
    };
    socket.on("donation", onDonation);
    return () => { socket.off("donation", onDonation); };
  }, [socketRef, settings.triggerMinCnt]);

  return (
    <div className="overlay-game">
      <div className={`overlay-roulette ${spinning ? "spinning" : ""}`}>🎡</div>
      {winner && <p className="overlay-game-winner">{spinning ? "돌아가는 중..." : `🎉 ${winner}님의 후원으로 룰렛이 돌았습니다!`}</p>}
      {!winner && <p className="muted">후원을 기다리는 중...</p>}
    </div>
  );
}
