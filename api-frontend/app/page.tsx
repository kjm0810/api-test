"use client";

import { FormEvent, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { uncompress } from "snappyjs";
import SocketGuide from "./socket-guide";

function decodeEvent<T>(payload: ArrayBuffer): T {
  const bytes = new Uint8Array(uncompress(payload) as ArrayBuffer);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://5.104.82.219:3000";
type Platform = "soop" | "chzzk";
type Streamer = { platform: Platform; streamer_id: string };
type Donation = { _id?: string; id?: string; platform: Platform; streamer_id?: string; streamerId?: string; nickname: string; amount: number; message: string; created_at?: string; createdAt?: string };

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
      const [links, history] = await Promise.all([request("/api/v1/streamers"), request("/donations/polling?limit=50")]);
      setStreamers(links.result); setDonations(history.result);
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

  const logout = () => { localStorage.removeItem("streamAccessToken"); setAccessToken(""); setStreamers([]); setDonations([]); };

  const addStreamer = async (event: FormEvent) => {
    event.preventDefault();
    try { await request("/api/v1/streamers", { method: "POST", body: JSON.stringify({ platform, streamerId }) }); setStreamerId(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "추가 실패"); }
  };

  const removeStreamer = async (item: Streamer) => {
    try { await request(`/api/v1/streamers/${item.platform}/${encodeURIComponent(item.streamer_id)}`, { method: "DELETE" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "삭제 실패"); }
  };

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
    <section className="panel key"><label>API KEY</label><input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); localStorage.setItem("streamApiKey", e.target.value); }} placeholder="회원가입 때 발급된 API 키"/><button onClick={() => navigator.clipboard.writeText(apiKey)} disabled={!apiKey}>복사</button><button onClick={load}>데이터 조회</button><button className="secondary" onClick={connectSocket} disabled={!apiKey}>Socket 연결</button></section>
    {error && <div className="error">{error}</div>}
    <div className="columns">
      <section className="panel"><div className="title"><h2>연결 스트리머</h2><b>{streamers.length}</b></div><form onSubmit={addStreamer}><select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}><option value="soop">SOOP</option><option value="chzzk">치지직</option></select><input value={streamerId} onChange={(e) => setStreamerId(e.target.value)} placeholder="스트리머 ID" required/><button>추가</button></form><div className="list">{streamers.map((item) => <div className="item" key={`${item.platform}:${item.streamer_id}`}><span className={`badge ${item.platform}`}>{item.platform.toUpperCase()}</span><code>{item.streamer_id}</code><button className="danger" onClick={() => removeStreamer(item)}>삭제</button></div>)}{!streamers.length && <p className="empty">연결된 스트리머가 없습니다.</p>}</div></section>
      <section className="panel"><div className="title"><h2>최근 후원</h2><b>{donations.length}</b></div><div className="list donations">{donations.map((item, index) => <div className="donation" key={item._id ?? item.id ?? index}><div><span className={`badge ${item.platform}`}>{item.platform.toUpperCase()}</span><strong>{item.nickname || "익명"}</strong><small>{item.streamer_id ?? item.streamerId}</small></div><b>{Number(item.amount).toLocaleString()}원</b>{item.message && <p>{item.message}</p>}</div>)}{!donations.length && <p className="empty">후원 데이터가 없습니다.</p>}</div></section>
    </div>
    <SocketGuide />
  </main>;
}
