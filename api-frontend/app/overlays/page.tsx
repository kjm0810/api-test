"use client";

import { FormEvent, useEffect, useState } from "react";
import AuthGate from "../components/AuthGate";
import Nav from "../components/Nav";
import { useAuth } from "../lib/useAuth";
import {
  DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings, OVERLAY_THEMES,
  type DonationTier, type DonationTypeFilter, type OverlaySettings,
} from "../lib/overlaySettings";

type Platform = "soop" | "chzzk";
type Streamer = { platform: Platform; streamer_id: string };

async function copyToClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

const DONATION_TYPE_LABELS: { key: keyof DonationTypeFilter; label: string }[] = [
  { key: "soopBalloon", label: "SOOP 별풍선" },
  { key: "soopVideo", label: "SOOP 영상풍선" },
  { key: "soopAdballoon", label: "SOOP 애드벌룬" },
  { key: "chzzkChat", label: "치지직 채팅 후원" },
  { key: "chzzkVideo", label: "치지직 영상 후원" },
  { key: "chzzkParty", label: "치지직 파티 후원" },
];

export default function OverlaysPage() {
  const { accessToken, setAuth, logout, request } = useAuth();
  const [token, setToken] = useState("");
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [platform, setPlatform] = useState<Platform>("soop");
  const [streamerId, setStreamerId] = useState("");
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      const data = await request("/api/v1/overlay");
      setToken(data.token);
      setSettings(normalizeOverlaySettings(data.settings));
      setStreamers(data.streamers);
    } catch (e) { setError(e instanceof Error ? e.message : "오버레이 조회 실패"); }
  };

  useEffect(() => {
    if (accessToken) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const addStreamer = async (event: FormEvent) => {
    event.preventDefault();
    try { await request("/api/v1/overlay/streamers", { method: "POST", body: JSON.stringify({ platform, streamerId }) }); setStreamerId(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "추가 실패"); }
  };

  const removeStreamer = async (item: Streamer) => {
    try { await request(`/api/v1/overlay/streamers/${item.platform}/${encodeURIComponent(item.streamer_id)}`, { method: "DELETE" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "삭제 실패"); }
  };

  const updateSettings = (patch: Partial<OverlaySettings>) => setSettings((current) => ({ ...current, ...patch }));

  const updateDonationType = (key: keyof DonationTypeFilter, value: boolean) =>
    setSettings((current) => ({ ...current, donationTypes: { ...current.donationTypes, [key]: value } }));

  const addTier = () =>
    setSettings((current) => ({ ...current, tiers: [...current.tiers, { min: 0, max: null, text: "{닉네임}님 {개수}개 감사합니다!", image: "" }] }));

  const updateTier = (index: number, patch: Partial<DonationTier>) =>
    setSettings((current) => ({ ...current, tiers: current.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)) }));

  const removeTier = (index: number) =>
    setSettings((current) => ({ ...current, tiers: current.tiers.filter((_, i) => i !== index) }));

  const save = async () => {
    try { await request("/api/v1/overlay", { method: "PATCH", body: JSON.stringify({ settings }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "설정 저장 실패"); }
  };

  const overlayUrl = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/overlay/${token}` : "";

  return (
    <AuthGate accessToken={accessToken} onAuth={setAuth}>
      <main>
        <header>
          <div><p className="eyebrow">STREAM EVENT API</p><h1>오버레이 설정</h1><p className="muted">계정당 오버레이 하나. 연결된 스트리머에게 후원이 오면 아래 설정대로 표시됩니다.</p></div>
          <div className="header-actions"><Nav /><button className="secondary" onClick={logout}>로그아웃</button></div>
        </header>
        {error && <div className="error">{error}</div>}

        <section className="panel overlay-panel">
          <div className="title"><h2>OBS URL</h2></div>
          <div className="overlay-row-url">
            <input readOnly value={overlayUrl} onFocus={(e) => e.target.select()} />
            <button onClick={() => void copyToClipboard(overlayUrl)} disabled={!overlayUrl}>URL 복사</button>
          </div>
        </section>

        <section className="panel overlay-panel">
          <div className="title"><h2>오버레이용 연결 스트리머</h2><b>{streamers.length}</b></div>
          <p className="muted">연결 스트리머(streamer_links)와 무관하게, 오버레이 전용으로 따로 관리됩니다.</p>
          <form onSubmit={addStreamer}>
            <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              <option value="soop">SOOP</option><option value="chzzk">치지직</option>
            </select>
            <input value={streamerId} onChange={(e) => setStreamerId(e.target.value)} placeholder="스트리머 ID" required />
            <button>추가</button>
          </form>
          <div className="list">
            {streamers.map((item) => (
              <div className="item" key={`${item.platform}:${item.streamer_id}`}>
                <span className={`badge ${item.platform}`}>{item.platform.toUpperCase()}</span>
                <code>{item.streamer_id}</code>
                <button className="danger" onClick={() => removeStreamer(item)}>삭제</button>
              </div>
            ))}
            {!streamers.length && <p className="empty">연결된 스트리머가 없습니다.</p>}
          </div>
        </section>

        <section className="panel overlay-panel">
          <div className="title"><h2>알림 설정</h2></div>

          <div className="overlay-settings-grid">
            <label>테마
              <select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value })}>
                {OVERLAY_THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
              </select>
            </label>
            <label>창 투명도 ({settings.transparency}%)
              <input type="range" min={0} max={100} value={settings.transparency}
                onChange={(e) => updateSettings({ transparency: Number(e.target.value) })} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={settings.tooltipMenu} onChange={(e) => updateSettings({ tooltipMenu: e.target.checked })} />
              창 툴팁 메뉴 사용
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={settings.ttsEnabled} onChange={(e) => updateSettings({ ttsEnabled: e.target.checked })} />
              메시지 음성(TTS) 사용
            </label>
          </div>

          <div className="overlay-donation-types">
            {DONATION_TYPE_LABELS.map(({ key, label }) => (
              <label key={key} className="checkbox-label">
                <input type="checkbox" checked={settings.donationTypes[key]} onChange={(e) => updateDonationType(key, e.target.checked)} />
                {label}
              </label>
            ))}
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
