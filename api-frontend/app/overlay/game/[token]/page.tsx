"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { decodeEvent } from "../../../lib/decode";
import { useOverlayJoin } from "../../../lib/useOverlayJoin";

type StreamEvent = { _id: string; nickname: string; cnt?: number };

type GameSettings = { gameType: "roulette"; triggerMinCnt: number };

function normalizeGameSettings(input: Partial<GameSettings> | undefined | null): GameSettings {
  return { gameType: "roulette", triggerMinCnt: 1, ...input };
}

export default function GameOverlayPage() {
  const params = useParams<{ token: string }>();
  const { state, error, settings: rawSettings, socketRef } = useOverlayJoin(params.token);
  const settings = normalizeGameSettings(rawSettings as Partial<GameSettings>);
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
    <div className="overlay-page">
      {(error || state !== "연결됨") && (
        <div className="overlay-topbar"><span className={`status ${state === "연결됨" ? "online" : ""}`}>{state}</span></div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="overlay-game">
        <div className={`overlay-roulette ${spinning ? "spinning" : ""}`}>🎡</div>
        {winner && <p className="overlay-game-winner">{spinning ? "돌아가는 중..." : `🎉 ${winner}님의 후원으로 룰렛이 돌았습니다!`}</p>}
        {!winner && <p className="muted">후원을 기다리는 중...</p>}
      </div>
    </div>
  );
}
