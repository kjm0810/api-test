"use client";

import { useEffect, useState } from "react";
import AuthGate from "../components/AuthGate";
import { copyToClipboard } from "../lib/clipboard";
import { useAuth } from "../lib/useAuth";

type GameSettings = { 
  gameType: "roulette"; 
  triggerMinCnt: number 
};

const DEFAULT_EXCEL_SETTINGS: GameSettings = { 
  gameType: "roulette", 
  triggerMinCnt: 1 
};

function normalizeGameSettings(input: Partial<GameSettings> | undefined | null): GameSettings {
  return { ...DEFAULT_EXCEL_SETTINGS, ...input };
}

export default function GameOverlaySettingsPage() {
  const { accessToken, setAuth, logout, request } = useAuth();
  const [token, setToken] = useState("");
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_EXCEL_SETTINGS);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      const data = await request("/api/v1/overlay/widgets");
      const widget = (data.result as { type: string; token: string; settings: unknown }[]).find((w) => w.type === "game");
      if (widget) { setToken(widget.token); setSettings(normalizeGameSettings(widget.settings as Partial<GameSettings>)); }
    } catch (e) { setError(e instanceof Error ? e.message : "조회 실패"); }
  };

  useEffect(() => {
    if (accessToken) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const save = async () => {
    try { await request("/api/v1/overlay/widgets/game", { method: "PATCH", body: JSON.stringify({ settings }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "설정 저장 실패"); }
  };

  const url = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/excel/${token}` : "";

  return (
    <AuthGate accessToken={accessToken} onAuth={setAuth}>
      <main>
        <header>
          <div><p className="eyebrow">STREAM EVENT API</p><h1>엑셀 오버레이 설정</h1><p className="muted">후원을 계기로 실행되는 미니게임입니다. 현재는 룰렛만 지원합니다.</p></div>
          <div className="header-actions"><button className="secondary" onClick={logout}>로그아웃</button></div>
        </header>
        {error && <div className="error">{error}</div>}

        <section className="panel overlay-panel">
          <div className="title"><h2>OBS URL</h2></div>
          <div className="overlay-row-url">
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
            <button onClick={() => void copyToClipboard(url)} disabled={!url}>URL 복사</button>
          </div>
        </section>

        <section className="panel overlay-panel">
          <div className="overlay-settings-grid">
            <label>게임 종류
              <select value={settings.gameType} onChange={(e) => setSettings((s) => ({ ...s, gameType: e.target.value as GameSettings["gameType"] }))}>
                <option value="roulette">룰렛 (구현됨)</option>
              </select>
            </label>
            <label>발동 최소 후원 개수
              <input type="number" min={1} value={settings.triggerMinCnt}
                onChange={(e) => setSettings((s) => ({ ...s, triggerMinCnt: Number(e.target.value) }))} />
            </label>
          </div>
          <button className="secondary overlay-save" onClick={save}>설정 저장</button>
        </section>
      </main>
    </AuthGate>
  );
}
