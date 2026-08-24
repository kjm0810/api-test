"use client";

import { useEffect, useState } from "react";
import AuthGate from "../components/AuthGate";
import { copyToClipboard } from "../lib/clipboard";
import { useAuth } from "../lib/useAuth";

type ChatSettings = { maxMessages: number; fontSize: number };

const DEFAULT_CHAT_SETTINGS: ChatSettings = { maxMessages: 30, fontSize: 16 };

function normalizeChatSettings(input: Partial<ChatSettings> | undefined | null): ChatSettings {
  return { ...DEFAULT_CHAT_SETTINGS, ...input };
}

export default function ChatOverlaySettingsPage() {
  const { accessToken, setAuth, logout, request } = useAuth();
  const [token, setToken] = useState("");
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      const data = await request("/api/v1/overlay/widgets");
      const widget = (data.result as { type: string; token: string; settings: unknown }[]).find((w) => w.type === "chat");
      if (widget) { setToken(widget.token); setSettings(normalizeChatSettings(widget.settings as Partial<ChatSettings>)); }
    } catch (e) { setError(e instanceof Error ? e.message : "조회 실패"); }
  };

  useEffect(() => {
    if (accessToken) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const save = async () => {
    try { await request("/api/v1/overlay/widgets/chat", { method: "PATCH", body: JSON.stringify({ settings }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "설정 저장 실패"); }
  };

  const url = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/chat/${token}` : "";

  return (
    <AuthGate accessToken={accessToken} onAuth={setAuth}>
      <main>
        <header>
          <div><p className="eyebrow">STREAM EVENT API</p><h1>채팅 오버레이 설정</h1><p className="muted">연결된 스트리머의 채팅을 실시간으로 표시합니다.</p></div>
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
            <label>최대 표시 개수
              <input type="number" min={1} max={200} value={settings.maxMessages}
                onChange={(e) => setSettings((s) => ({ ...s, maxMessages: Number(e.target.value) }))} />
            </label>
            <label>폰트 크기 ({settings.fontSize}px)
              <input type="range" min={10} max={40} value={settings.fontSize}
                onChange={(e) => setSettings((s) => ({ ...s, fontSize: Number(e.target.value) }))} />
            </label>
          </div>
          <button className="secondary overlay-save" onClick={save}>설정 저장</button>
        </section>
      </main>
    </AuthGate>
  );
}
