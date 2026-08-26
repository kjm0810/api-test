"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { decodeEvent } from "../../lib/decode";
import { useOverlayJoin } from "../../lib/useOverlayJoin";

type Platform = "soop" | "chzzk" | "youtube";
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

type QueuedAlert = { id: string; text: string; image: string; platform: Platform };
type Phase = "enter" | "hold" | "exit";

const ENTER_MS = 1000;
const EXIT_MS = 1000;
const NO_TTS_HOLD_MS = 2000;
// 로딩/재생 종료 이벤트를 못 받는 경우를 대비한 안전장치
const TTS_LOAD_TIMEOUT_MS = 5000;
const TTS_FALLBACK_HOLD_MS = 8000;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// <audio src="..."> 로 로드하면 fetch()와 달리 CORS 검사를 받지 않는다(no-cors 미디어 요청).
// canplaythrough까지 기다려서 "응답을 다 받아온 뒤" 재생을 시작한다.
function loadTtsAudio(text: string): Promise<HTMLAudioElement | null> {
  return new Promise((resolve) => {
    const url = `https://www.google.com/speech-api/v1/synthesize?ie=UTF-8&text=${encodeURIComponent(text)}&lang=ko`;
    const audio = new Audio(url);
    audio.preload = "auto";
    let done = false;
    const finish = (result: HTMLAudioElement | null) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    audio.addEventListener("canplaythrough", () => finish(audio), { once: true });
    audio.addEventListener("error", () => finish(null), { once: true });
    setTimeout(() => finish(audio), TTS_LOAD_TIMEOUT_MS);
  });
}

function playAudio(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.play().catch(finish);
    setTimeout(finish, TTS_FALLBACK_HOLD_MS);
  });
}

export default function DonationOverlayPage() {
  const params = useParams<{ token: string }>();
  const { state, error, settings: rawSettings, socketRef } = useOverlayJoin(params.token);
  const settings = normalizeOverlaySettings(rawSettings as Partial<OverlaySettings>);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [current, setCurrent] = useState<QueuedAlert | null>(null);
  const [phase, setPhase] = useState<Phase>("enter");
  // 큐는 ref로 관리 — state로 두면 재생 루프 useEffect가 자기 자신의 setState 때문에
  // 재실행/cleanup되어 등장 직후 로직이 끊기는 문제가 있었음
  const queueRef = useRef<QueuedAlert[]>([]);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    // StrictMode(개발 모드)에서 effect가 mount→unmount→mount로 재실행되므로 다시 true로 되돌려야 함
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const runQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    while (mountedRef.current) {
      const next = queueRef.current.shift();
      if (!next) break;

      const audio = settingsRef.current.ttsEnabled ? await loadTtsAudio(next.text) : null;
      if (!mountedRef.current) break;

      setCurrent(next);
      setPhase("enter");
      await wait(ENTER_MS);
      if (!mountedRef.current) break;

      setPhase("hold");
      if (audio) {
        await playAudio(audio);
      } else {
        await wait(NO_TTS_HOLD_MS);
      }
      if (!mountedRef.current) break;

      setPhase("exit");
      await wait(EXIT_MS);
      if (!mountedRef.current) break;

      setCurrent(null);
    }
    processingRef.current = false;
  };

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onDonation = (payload: ArrayBuffer) => {
      try {
        const event = decodeEvent<StreamEvent>(payload);
        const cnt = event.cnt ?? 0;
        const amount = event.amount ?? 0;
        const tier = pickTier(settingsRef.current, cnt);
        const text = renderTemplate(tier?.text ?? settingsRef.current.defaultText, {
          nickname: event.nickname || "익명", cnt, amount, message: event.message,
        });
        queueRef.current.push({ id: event._id, text, image: tier?.image ?? "", platform: event.platform });
        void runQueue();
      } catch { /* 압축 해제/파싱 실패한 이벤트는 무시 */ }
    };
    socket.on("donation", onDonation);
    return () => { socket.off("donation", onDonation); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketRef]);

  return (
    <div className="overlay-page">
      {(error || state !== "연결됨") && (
        <div className="overlay-topbar"><span className={`status ${state === "연결됨" ? "online" : ""}`}>{state}</span></div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="overlay-feed overlay-donation" style={{ fontSize: settings.fontSize }}>
        {current && (
          <div className={`overlay-card donation phase-${phase}`}>
            {current.image && <img src={current.image} alt="" className="overlay-alert-image" />}
            <span className={`badge ${current.platform}`}>{current.platform.toUpperCase()}</span>
            <span>{current.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
