"use client";

import { FormEvent, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { decodeEvent } from "./lib/decode";
import SocketGuide from "./socket-guide";

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

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://5.104.82.219:3000";
type Platform = "soop" | "chzzk";
type Streamer = { platform: Platform; streamer_id: string };
type Donation = { _id?: string; id?: string; platform: Platform; streamer_id?: string; streamerId?: string; nickname: string; amount: number; message: string; created_at?: string; createdAt?: string };
type OverlayStreamer = { platform: Platform; streamerId: string };
type Overlay = { id: number; token: string; settings: Record<string, unknown>; streamers: OverlayStreamer[] };

export default function Home() {
  const [accessToken, setAccessToken] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [platform, setPlatform] = useState<Platform>("soop");
  const [streamerId, setStreamerId] = useState("");
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [socketState, setSocketState] = useState("연결 안 됨");
  const [error, setError] = useState("");
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [overlayPlatform, setOverlayPlatform] = useState<Platform>("soop");
  const [overlayStreamerId, setOverlayStreamerId] = useState("");
  const [overlayDraft, setOverlayDraft] = useState<OverlayStreamer[]>([]);
  const [overlaySettingsDrafts, setOverlaySettingsDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    setApiKey(localStorage.getItem("streamApiKey") ?? "");
    setAccessToken(localStorage.getItem("streamAccessToken") ?? "");
  }, []);

  const headers = { "x-api-key": apiKey, authorization: accessToken ? `Bearer ${accessToken}` : "", "content-type": "application/json" };
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  };

  const load = async () => {
    try {
      setError(""); localStorage.setItem("streamApiKey", apiKey);
      const [links, history, overlayList] = await Promise.all([
        request("/api/v1/streamers"), request("/donations/polling?limit=50"), request("/api/v1/overlays"),
      ]);
      setStreamers(links.result); setDonations(history.result); setOverlays(overlayList.result);
    } catch (e) { setError(e instanceof Error ? e.message : "조회 실패"); }
  };

  useEffect(() => {
    if (accessToken) void load();
    // accessToken이 복원되거나 로그인된 직후 한 번 자동 조회합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const response = await fetch(`${API}/auth/${authMode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(authMode === "signup" ? { name, email, password } : { email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "인증 실패");
      setAccessToken(data.accessToken); localStorage.setItem("streamAccessToken", data.accessToken);
      if (data.apiKey) { setApiKey(data.apiKey); localStorage.setItem("streamApiKey", data.apiKey); }
    } catch (e) { setError(e instanceof Error ? e.message : "인증 실패"); }
  };

  const logout = () => { localStorage.removeItem("streamAccessToken"); setAccessToken(""); setStreamers([]); setDonations([]); setOverlays([]); };

  const addStreamer = async (event: FormEvent) => {
    event.preventDefault();
    try { await request("/api/v1/streamers", { method: "POST", body: JSON.stringify({ platform, streamerId }) }); setStreamerId(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "추가 실패"); }
  };

  const removeStreamer = async (item: Streamer) => {
    try { await request(`/api/v1/streamers/${item.platform}/${encodeURIComponent(item.streamer_id)}`, { method: "DELETE" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "삭제 실패"); }
  };

  const addOverlayDraftStreamer = (event: FormEvent) => {
    event.preventDefault();
    if (!overlayStreamerId.trim()) return;
    setOverlayDraft((current) => [...current, { platform: overlayPlatform, streamerId: overlayStreamerId.trim() }]);
    setOverlayStreamerId("");
  };

  const removeOverlayDraftStreamer = (index: number) =>
    setOverlayDraft((current) => current.filter((_, i) => i !== index));

  const createOverlay = async () => {
    if (!overlayDraft.length) { setError("오버레이에 연결할 스트리머를 먼저 추가하세요."); return; }
    try {
      await request("/api/v1/overlays", { method: "POST", body: JSON.stringify({ streamers: overlayDraft, settings: {} }) });
      setOverlayDraft([]);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "오버레이 생성 실패"); }
  };

  const deleteOverlay = async (id: number) => {
    try { await request(`/api/v1/overlays/${id}`, { method: "DELETE" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "오버레이 삭제 실패"); }
  };

  const saveOverlaySettings = async (id: number, defaultText: string) => {
    try {
      const settings = JSON.parse(overlaySettingsDrafts[id] ?? defaultText);
      await request(`/api/v1/overlays/${id}`, { method: "PATCH", body: JSON.stringify({ settings }) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "설정 저장 실패 (JSON 형식을 확인하세요)"); }
  };

  const overlayUrl = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/overlay/${token}`;

  const connectSocket = () => {
    setSocketState("연결 중");
    const socket: Socket = io(API, { transports: ["websocket"] });
    socket.on("connect", () => socket.emit("login", apiKey));
    socket.on("ready", () => setSocketState("연결됨"));
    socket.on("donation", (payload: ArrayBuffer) => {
      try { setDonations((current) => [decodeEvent<Donation>(payload), ...current].slice(0, 100)); }
      catch (e) { setError(e instanceof Error ? e.message : "이벤트 해제 실패"); }
    });
    socket.on("connect_error", (e) => { setSocketState("오류"); setError(e.message); });
    socket.on("disconnect", () => setSocketState("연결 끊김"));
    return socket;
  };

  if (!accessToken) return <main className="auth-page"><section className="panel auth"><p className="eyebrow">STREAM EVENT API</p><h1>{authMode === "login" ? "로그인" : "회원가입"}</h1><p className="muted">SOOP · 치지직 이벤트 API를 시작하세요.</p><form onSubmit={submitAuth}>{authMode === "signup" && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" required/>}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" required/><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 (8자 이상)" required/><button>{authMode === "login" ? "로그인" : "가입하고 API 키 발급"}</button></form>{error && <div className="error">{error}</div>}<button className="link" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>{authMode === "login" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}</button></section></main>;

  return <main>
    <header><div><p className="eyebrow">STREAM EVENT API</p><h1>SOOP · 치지직 통합 콘솔</h1><p className="muted">스트리머 연결과 실시간 후원 이벤트를 한곳에서 관리합니다.</p></div><div className="header-actions"><span className={`status ${socketState === "연결됨" ? "online" : ""}`}>{socketState}</span><button className="secondary" onClick={logout}>로그아웃</button></div></header>
    <section className="panel key"><label>API KEY</label><input type="text" value={apiKey} onChange={(e) => { setApiKey(e.target.value); localStorage.setItem("streamApiKey", e.target.value); }} placeholder="회원가입 때 발급된 API 키"/><button onClick={() => void copyToClipboard(apiKey)} disabled={!apiKey}>복사</button></section>
    {error && <div className="error">{error}</div>}
      <section className="panel"><div className="title"><h2>연결 스트리머</h2><b>{streamers.length}</b></div><form onSubmit={addStreamer}><select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}><option value="soop">SOOP</option><option value="chzzk">치지직</option></select><input value={streamerId} onChange={(e) => setStreamerId(e.target.value)} placeholder="스트리머 ID" required/><button>추가</button></form><div className="list">{streamers.map((item) => <div className="item" key={`${item.platform}:${item.streamer_id}`}><span className={`badge ${item.platform}`}>{item.platform.toUpperCase()}</span><code>{item.streamer_id}</code><button className="danger" onClick={() => removeStreamer(item)}>삭제</button></div>)}{!streamers.length && <p className="empty">연결된 스트리머가 없습니다.</p>}</div></section>

    <section className="panel overlay-panel">
      <div className="title"><h2>오버레이</h2><b>{overlays.length}</b></div>
      <p className="muted">OBS 브라우저 소스에 붙일 URL을 발급합니다. streamer_links와 무관하게 원하는 스트리머를 자유롭게 골라 연결할 수 있습니다.</p>
      <form onSubmit={addOverlayDraftStreamer}>
        <select value={overlayPlatform} onChange={(e) => setOverlayPlatform(e.target.value as Platform)}>
          <option value="soop">SOOP</option><option value="chzzk">치지직</option>
        </select>
        <input value={overlayStreamerId} onChange={(e) => setOverlayStreamerId(e.target.value)} placeholder="스트리머 ID" />
        <button>스트리머 추가</button>
      </form>
      {overlayDraft.length > 0 && (
        <div className="list">
          {overlayDraft.map((item, index) => (
            <div className="item" key={`${item.platform}:${item.streamerId}:${index}`}>
              <span className={`badge ${item.platform}`}>{item.platform.toUpperCase()}</span>
              <code>{item.streamerId}</code>
              <button className="danger" onClick={() => removeOverlayDraftStreamer(index)}>제거</button>
            </div>
          ))}
        </div>
      )}
      <button className="secondary overlay-create" onClick={createOverlay} disabled={!overlayDraft.length}>오버레이 생성</button>

      <div className="list">
        {overlays.map((item) => {
          const defaultText = JSON.stringify(item.settings, null, 2);
          return (
            <div className="overlay-row" key={item.id}>
              <div className="overlay-row-head">
                {item.streamers.map((s) => (
                  <span key={`${s.platform}:${s.streamerId}`} className={`badge ${s.platform}`}>{s.platform.toUpperCase()} {s.streamerId}</span>
                ))}
                <button className="danger" onClick={() => deleteOverlay(item.id)}>삭제</button>
              </div>
              <div className="overlay-row-url">
                <input readOnly value={overlayUrl(item.token)} onFocus={(e) => e.target.select()} />
                <button onClick={() => void copyToClipboard(overlayUrl(item.token))}>URL 복사</button>
              </div>
              <textarea
                className="overlay-settings"
                value={overlaySettingsDrafts[item.id] ?? defaultText}
                onChange={(e) => setOverlaySettingsDrafts((current) => ({ ...current, [item.id]: e.target.value }))}
              />
              <button className="secondary" onClick={() => saveOverlaySettings(item.id, defaultText)}>설정 저장</button>
            </div>
          );
        })}
        {!overlays.length && <p className="empty">생성된 오버레이가 없습니다.</p>}
      </div>
    </section>

    <SocketGuide />
  </main>;
}
