"use client";

import { useEffect, useState } from "react";
import AuthGate from "../../components/AuthGate";
import Nav from "../../components/Nav";
import { copyToClipboard } from "../../lib/clipboard";
import { useAuth } from "../../lib/useAuth";

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

export default function DonationOverlaySettingsPage() {
  const { accessToken, setAuth, logout, request } = useAuth();
  const [token, setToken] = useState("");
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      const data = await request("/api/v1/overlay/widgets");
      const widget = (data.result as { type: string; token: string; settings: unknown }[]).find((w) => w.type === "donation");
      if (widget) { setToken(widget.token); setSettings(normalizeOverlaySettings(widget.settings as Partial<OverlaySettings>)); }
    } catch (e) { setError(e instanceof Error ? e.message : "조회 실패"); }
  };

  useEffect(() => {
    if (accessToken) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const save = async () => {
    try { await request("/api/v1/overlay/widgets/donation", { method: "PATCH", body: JSON.stringify({ settings }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "설정 저장 실패"); }
  };

  const updateSettings = (patch: Partial<OverlaySettings>) => setSettings((current) => ({ ...current, ...patch }));
  const addTier = () =>
    setSettings((current) => ({ ...current, tiers: [...current.tiers, { min: 0, max: null, text: "{닉네임}님 {개수}개 감사합니다!", image: "" }] }));
  const updateTier = (index: number, patch: Partial<DonationTier>) =>
    setSettings((current) => ({ ...current, tiers: current.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)) }));
  const removeTier = (index: number) =>
    setSettings((current) => ({ ...current, tiers: current.tiers.filter((_, i) => i !== index) }));

  const url = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/overlay/donation/${token}` : "";

  return (
    <AuthGate accessToken={accessToken} onAuth={setAuth}>
      <main>
        <header>
          <div><p className="eyebrow">STREAM EVENT API</p><h1>후원 알림 설정</h1><p className="muted">연결된 스트리머에게 후원이 오면 아래 설정대로 표시됩니다.</p></div>
          <div className="header-actions"><Nav /><button className="secondary" onClick={logout}>로그아웃</button></div>
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
            <label>폰트 크기 ({settings.fontSize}px)
              <input type="range" min={10} max={40} value={settings.fontSize}
                onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={settings.ttsEnabled} onChange={(e) => updateSettings({ ttsEnabled: e.target.checked })} />
              메시지 음성(TTS) 사용
            </label>
          </div>

          <label className="overlay-default-text">기본 알림 텍스트 (구간에 안 걸리면 이걸 사용)
            <input value={settings.defaultText} onChange={(e) => updateSettings({ defaultText: e.target.value })} />
          </label>
          <p className="muted">사용 가능한 값: {"{닉네임} {개수} {금액} {메시지}"}</p>

          <div className="overlay-tiers">
            <div className="title"><h3>후원 개수 구간별 알림</h3><button type="button" className="secondary" onClick={addTier}>구간 추가</button></div>
            {settings.tiers.map((tier, index) => (
              <div className="overlay-tier-row" key={index}>
                <input type="number" min={0} value={tier.min} onChange={(e) => updateTier(index, { min: Number(e.target.value) })} placeholder="최소 개수" />
                <span>~</span>
                <input type="number" min={0} value={tier.max ?? ""} onChange={(e) => updateTier(index, { max: e.target.value === "" ? null : Number(e.target.value) })} placeholder="최대 개수(비우면 무제한)" />
                <input value={tier.text} onChange={(e) => updateTier(index, { text: e.target.value })} placeholder="알림 텍스트" />
                <input value={tier.image} onChange={(e) => updateTier(index, { image: e.target.value })} placeholder="이미지 URL(선택)" />
                <button className="danger" onClick={() => removeTier(index)}>삭제</button>
              </div>
            ))}
            {!settings.tiers.length && <p className="empty">등록된 구간이 없습니다. 없으면 기본 텍스트로 표시됩니다.</p>}
          </div>

          <button className="secondary overlay-save" onClick={save}>설정 저장</button>
        </section>
      </main>
    </AuthGate>
  );
}
