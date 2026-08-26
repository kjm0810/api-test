"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import AuthGate from "./components/AuthGate";
import { useAuth } from "./lib/useAuth";

type Platform = "soop" | "chzzk" | "youtube";
type Streamer = { platform: Platform; streamer_id: string };

const WIDGET_LINKS: { href: string; icon: string; title: string; description: string }[] = [
  { href: "/donation", icon: "💰", title: "후원 알림", description: "구간별 텍스트/이미지·TTS·폰트 크기 설정" },
  { href: "/chat", icon: "💬", title: "채팅", description: "실시간 채팅 표시 설정" },
  { href: "/game", icon: "🎮", title: "게임", description: "후원 계기 미니게임 설정 (룰렛)" },
  { href: "/excel", icon: "엑셀", title: "엑셀", description: "엑셀용 오버레이" },
];

export default function OverlaysPage() {
  const { accessToken, setAuth, logout, request } = useAuth();
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [platform, setPlatform] = useState<Platform>("soop");
  const [streamerId, setStreamerId] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setError("");
      const data = await request("/api/v1/overlay/streamers");
      setStreamers(data.result);
    } catch (e) { setError(e instanceof Error ? e.message : "조회 실패"); }
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

  return (
    <AuthGate accessToken={accessToken} onAuth={setAuth}>
      <main>
        <header>
          <div><p className="eyebrow">STREAM EVENT API</p><h1>오버레이</h1><p className="muted">후원 알림·채팅·게임 3종류의 설정 페이지와 OBS 연결용 스트리머를 관리합니다.</p></div>
          <div className="header-actions"><button className="secondary" onClick={logout}>로그아웃</button></div>
        </header>
        {error && <div className="error">{error}</div>}

        <section className="panel overlay-panel">
          <div className="title"><h2>위젯 설정</h2></div>
          <div className="widget-links">
            {WIDGET_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className="widget-link-card">
                <span className="icon">{item.icon}</span>
                <h3>{item.title}</h3>
                <p className="muted">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="panel overlay-panel">
          <div className="title"><h2>오버레이용 연결 스트리머</h2><b>{streamers.length}</b></div>
          <p className="muted">연결 스트리머(streamer_links)와 무관하게, 오버레이 전용으로 따로 관리됩니다. 3개 위젯이 이 목록을 공용으로 씁니다.</p>
          <form onSubmit={addStreamer}>
            <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              <option value="soop">SOOP</option><option value="chzzk">치지직</option><option value="youtube">YouTube</option>
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
      </main>
    </AuthGate>
  );
}
