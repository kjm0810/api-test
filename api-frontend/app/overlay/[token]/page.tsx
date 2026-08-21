"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { decodeEvent } from "../../lib/decode";
import {
  DEFAULT_OVERLAY_SETTINGS, isDonationTypeEnabled, normalizeOverlaySettings, pickTier, renderTemplate,
  type OverlaySettings,
} from "../../lib/overlaySettings";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://5.104.82.219:3000";

type Platform = "soop" | "chzzk";
type StreamEvent = {
  _id: string; platform: Platform; type: "chat" | "donation";
  streamer_id: string; streamer_nickname: string;
  user_id: string; nickname: string; message: string;
  cnt?: number; amount?: number; extras?: unknown;
};
type Alert = { id: string; text: string; image: string; platform: Platform };

export default function OverlayTokenPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [state, setState] = useState<"연결 중" | "연결됨" | "오류">("연결 중");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    document.body.classList.add("overlay-mode");
    return () => { document.body.classList.remove("overlay-mode"); };
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(`${API}/overlay`, { transports: ["websocket"], timeout: 5000 });
    socket.on("connect", () => socket.emit("join", token));
    socket.on("joined", (data: { settings?: Partial<OverlaySettings> }) => {
      setState("연결됨");
      setSettings(normalizeOverlaySettings(data.settings));
    });
    socket.on("join_error", (data: { error: string }) => { setState("오류"); setError(data.error); });
    socket.on("connect_error", (err) => { setState("오류"); setError(err.message); });

    const onDonation = (payload: ArrayBuffer) => {
      try {
        const event = decodeEvent<StreamEvent>(payload);
        const current = settingsRef.current;
        if (!isDonationTypeEnabled(current, event)) return;
        const cnt = event.cnt ?? 0;
        const amount = event.amount ?? 0;
        const tier = pickTier(current, cnt);
        const text = renderTemplate(tier?.text ?? current.defaultText, {
          nickname: event.nickname || "익명", cnt, amount, message: event.message,
        });
        const alert: Alert = { id: event._id, text, image: tier?.image ?? "", platform: event.platform };
        setAlerts((list) => [alert, ...list].slice(0, 20));
        if (current.ttsEnabled && "speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = "ko-KR";
          window.speechSynthesis.speak(utterance);
        }
      } catch { /* 압축 해제/파싱 실패한 이벤트는 무시 */ }
    };
    socket.on("donation", onDonation);

    return () => { socket.disconnect(); };
  }, [token]);

  return (
    <div className={`overlay-page theme-${settings.theme}`} style={{ opacity: settings.transparency / 100 }}>
      {(error || state !== "연결됨") && (
        <div className="overlay-topbar">
          <span className={`status ${state === "연결됨" ? "online" : ""}`}>{state}</span>
        </div>
      )}
      {error && <div className="error">{error}</div>}
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
