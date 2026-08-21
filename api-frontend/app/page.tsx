"use client";

import { FormEvent, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import AuthGate from "./components/AuthGate";
import Nav from "./components/Nav";
import { copyToClipboard } from "./lib/clipboard";
import { decodeEvent } from "./lib/decode";
import { API, useAuth } from "./lib/useAuth";
import SocketGuide from "./socket-guide";

type Platform = "soop" | "chzzk";
type Streamer = { platform: Platform; streamer_id: string };
type Donation = { _id?: string; id?: string; platform: Platform; streamer_id?: string; streamerId?: string; nickname: string; amount: number; message: string; created_at?: string; createdAt?: string };

export default function Home() {
  const { accessToken, apiKey, setAuth, updateApiKey, logout, request } = useAuth();
  const [platform, setPlatform] = useState<Platform>("soop");
  const [streamerId, setStreamerId] = useState("");
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [socketState, setSocketState] = useState("연결 안 됨");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      const [links, history] = await Promise.all([request("/api/v1/streamers"), request("/donations/polling?limit=50")]);
      setStreamers(links.result); setDonations(history.result);
    } catch (e) { setError(e instanceof Error ? e.message : "조회 실패"); }
  };

  useEffect(() => {
    if (accessToken) void load();
    // accessToken이 복원되거나 로그인된 직후 한 번 자동 조회합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

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

  return (
    <AuthGate accessToken={accessToken} onAuth={setAuth}>
      <main>
        <header>
          <div><p className="eyebrow">STREAM EVENT API</p><h1>SOOP · 치지직 통합 콘솔</h1><p className="muted">스트리머 연결과 실시간 후원 이벤트를 한곳에서 관리합니다.</p></div>
          <div className="header-actions"><Nav /><span className={`status ${socketState === "연결됨" ? "online" : ""}`}>{socketState}</span><button className="secondary" onClick={logout}>로그아웃</button></div>
        </header>
        <section className="panel key"><label>API KEY</label><input type="text" value={apiKey} onChange={(e) => updateApiKey(e.target.value)} placeholder="회원가입 때 발급된 API 키" /><button onClick={() => void copyToClipboard(apiKey)} disabled={!apiKey}>복사</button></section>
        {error && <div className="error">{error}</div>}
        <section className="panel"><div className="title"><h2>연결 스트리머</h2><b>{streamers.length}</b></div><form onSubmit={addStreamer}><select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}><option value="soop">SOOP</option><option value="chzzk">치지직</option></select><input value={streamerId} onChange={(e) => setStreamerId(e.target.value)} placeholder="스트리머 ID" required /><button>추가</button></form><div className="list">{streamers.map((item) => <div className="item" key={`${item.platform}:${item.streamer_id}`}><span className={`badge ${item.platform}`}>{item.platform.toUpperCase()}</span><code>{item.streamer_id}</code><button className="danger" onClick={() => removeStreamer(item)}>삭제</button></div>)}{!streamers.length && <p className="empty">연결된 스트리머가 없습니다.</p>}</div></section>
        <SocketGuide />
      </main>
    </AuthGate>
  );
}
