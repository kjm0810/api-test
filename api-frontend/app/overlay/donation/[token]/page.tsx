"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { decodeEvent } from "../../../lib/decode";
import { useOverlayJoin } from "../../../lib/useOverlayJoin";

type Platform = "soop" | "chzzk";
type StreamEvent = {
  _id: string; platform: Platform; nickname: string; message: string;
  cnt?: number; amount?: number;
};

type DonationTier = { min: number; max: number | null; text: string; image: string };

type OverlaySettings = {
  defaultText: string;
  tiers: DonationTier[];
  ttsEnabled: boolean;
  fontSize: number;
};

const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  defaultText: "{닉네임}님 {개수}개 감사합니다!",
  tiers: [],
  ttsEnabled: false,
  fontSize: 16,
};

function normalizeOverlaySettings(input: Partial<OverlaySettings> | undefined | null): OverlaySettings {
  return {
    ...DEFAULT_OVERLAY_SETTINGS,
    ...input,
    tiers: input?.tiers ?? [],
  };
}

function pickTier(settings: OverlaySettings, cnt: number): DonationTier | null {
  return settings.tiers.find((tier) => cnt >= tier.min && (tier.max == null || cnt <= tier.max)) ?? null;
}

function renderTemplate(template: string, vars: { nickname: string; cnt: number; amount: number; message: string }) {
  return template
    .replaceAll("{닉네임}", vars.nickname)
    .replaceAll("{개수}", String(vars.cnt))
    .replaceAll("{금액}", vars.amount.toLocaleString())
    .replaceAll("{메시지}", vars.message);
}

export default function DonationOverlayPage() {
  const params = useParams<{ token: string }>();
  const { state, error, settings: rawSettings, socketRef } = useOverlayJoin(params.token);
  const settings = normalizeOverlaySettings(rawSettings as Partial<OverlaySettings>);
  const [alerts, setAlerts] = useState<{ id: string; text: string; image: string; platform: Platform }[]>([]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onDonation = (payload: ArrayBuffer) => {
      try {
        const event = decodeEvent<StreamEvent>(payload);
        const cnt = event.cnt ?? 0;
        const amount = event.amount ?? 0;
        const tier = pickTier(settings, cnt);
        const text = renderTemplate(tier?.text ?? settings.defaultText, {
          nickname: event.nickname || "익명", cnt, amount, message: event.message,
        });
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
    <div className="overlay-page">
      {(error || state !== "연결됨") && (
        <div className="overlay-topbar"><span className={`status ${state === "연결됨" ? "online" : ""}`}>{state}</span></div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="overlay-feed" style={{ fontSize: settings.fontSize }}>
        {alerts.map((alert) => (
          <div key={alert.id} className="overlay-card donation">
            {alert.image && <img src={alert.image} alt="" className="overlay-alert-image" />}
            <span className={`badge ${alert.platform}`}>{alert.platform.toUpperCase()}</span>
            <span>{alert.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
