"use client";

import { useState } from "react";

const code = `const io = require("socket.io-client");
const { uncompressSync } = require("snappy");

const socket = io("http://5.104.82.219:3000", {
  transports: ["websocket"],
  timeout: 5000,
});

socket.on("connect", () => {
  socket.emit("login", "YOUR_API_KEY");
});

socket.on("ready", ({ streamers }) => {
  console.log("연결 완료", streamers);
});

// chat, donation 이벤트는 Snappy로 압축되어 전달됩니다.
const decode = (payload) => JSON.parse(uncompressSync(payload).toString("utf8"));

socket.on("chat", (payload) => console.log("채팅", decode(payload)));
socket.on("donation", (payload) => console.log("후원", decode(payload)));

socket.on("login_error", console.error);
socket.on("connect_error", console.error);`;

const overlayCode = `const io = require("socket.io-client");
const { uncompressSync } = require("snappy");

// 회원가입/로그인 없이, 고정 시크릿 + 구독할 스트리머 배열만으로 연결합니다.
const socket = io("http://5.104.82.219:3000/overlay", {
  transports: ["websocket"],
  timeout: 5000,
});

socket.on("connect", () => {
  socket.emit("subscribe", {
    secret: "gklfduatslaknbvcx0pr48982",
    streamers: [
      { platform: "soop", id: "streamer1" },
      { platform: "chzzk", id: "streamer2" },
    ],
  });
});

socket.on("subscribed", ({ streamers }) => {
  console.log("구독됨", streamers);
});

const decode = (payload) => JSON.parse(uncompressSync(payload).toString("utf8"));
socket.on("chat", (payload) => console.log("채팅", decode(payload)));
socket.on("donation", (payload) => console.log("후원", decode(payload)));

socket.on("subscribe_error", console.error);
socket.on("connect_error", console.error);`;

const pollingCode = `curl "http://5.104.82.219:3000/donations/polling?limit=50" \\
  -H "Authorization: Bearer YOUR_API_KEY"

// 응답
// {
//   "error": 0,
//   "currentCursor": null,
//   "nextCursor": "6f2b...",
//   "result": [ { "_id": "...", "platform": "soop", "amount": 1000, ... } ],
//   "length": 50
// }`;

type Endpoint = {
  method: string;
  path: string;
  auth: string;
  request: string;
  response: string;
};

const endpoints: Endpoint[] = [
  {
    method: "POST", path: "/auth/signup", auth: "없음",
    request: `{ "name": "string(2~100자)", "email": "string", "password": "string(8~72자)" }`,
    response: `201 { accessToken, apiKey, user: { id, name, email } }\n409 { "error": "email_already_exists" }`,
  },
  {
    method: "POST", path: "/auth/login", auth: "없음",
    request: `{ "email": "string", "password": "string" }`,
    response: `200 { accessToken, user: { id, name, email } }\n401 { "error": "invalid_email_or_password" }`,
  },
  {
    method: "GET", path: "/api/v1/me", auth: "Bearer JWT 또는 API Key",
    request: "(없음)",
    response: `200 { user: { id, name, email } }`,
  },
  {
    method: "GET", path: "/api/v1/api-keys", auth: "Bearer JWT 또는 API Key",
    request: "(없음)",
    response: `200 { result: [{ id, key_prefix, active, last_used_at, created_at }] }`,
  },
  {
    method: "GET", path: "/api/v1/streamers", auth: "Bearer JWT 또는 API Key",
    request: "(없음)",
    response: `200 { result: [{ platform, streamer_id }] }`,
  },
  {
    method: "POST", path: "/api/v1/streamers", auth: "Bearer JWT 또는 API Key",
    request: `{ "platform": "soop" | "chzzk", "streamerId": "string(1~100자)" }`,
    response: `201 { platform, streamerId }`,
  },
  {
    method: "DELETE", path: "/api/v1/streamers/:platform/:streamerId", auth: "Bearer JWT 또는 API Key",
    request: "Path Parameters: platform, streamerId",
    response: `204 (본문 없음)`,
  },
  {
    method: "GET", path: "/donations/polling", auth: "Bearer(API Key)",
    request: "Query: cursor?(string), limit?(≤100, 기본 50)",
    response: `200 { error: 0, currentCursor, nextCursor, result: [...], length }`,
  },
];

export default function SocketGuide() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <section className="panel socket-guide">
      <div className="title">
        <div><p className="eyebrow">API REFERENCE</p><h2>REQUEST 정의</h2></div>
      </div>
      <div className="endpoint-table">
        {endpoints.map((endpoint) => (
          <div className="endpoint-row" key={`${endpoint.method} ${endpoint.path}`}>
            <div className="endpoint-head">
              <span className={`method ${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
              <code>{endpoint.path}</code>
              <span className="auth-badge">{endpoint.auth}</span>
            </div>
            <div className="endpoint-body">
              <div><b>Request</b><pre>{endpoint.request}</pre></div>
              <div><b>Response</b><pre>{endpoint.response}</pre></div>
            </div>
          </div>
        ))}
      </div>

      <div className="title">
        <div><p className="eyebrow">SOCKET.IO GUIDE</p><h2>회원용 실시간 이벤트 연결</h2></div>
        <button type="button" className="secondary" onClick={() => copy("member", code)}>{copied === "member" ? "복사됨" : "코드 복사"}</button>
      </div>
      <p className="muted">API 키 계정에 등록된 스트리머의 이벤트만 수신합니다. handshake가 아닌 접속 후 login 이벤트로 인증하며, chat·donation 이벤트는 Snappy로 압축되어 전달됩니다.</p>
      <div className="guide-steps">
        <code>npm install socket.io-client snappy</code>
        <code>Socket 서버: http://5.104.82.219:3000</code>
      </div>
      <pre><code>{code}</code></pre>
      <div className="schema-grid">
        <div><h3>chat</h3><code>_id, platform, type, user_id, nickname, streamer_id, streamer_nickname, message, extras</code></div>
        <div><h3>donation</h3><code>chat 필드 + cnt, amount · SOOP: extras.typeName · 치지직: extras.chzzk.donationType</code></div>
      </div>

      <div className="title">
        <div><p className="eyebrow">OVERLAY SOCKET.IO GUIDE</p><h2>오버레이(OBS)용 연결</h2></div>
        <button type="button" className="secondary" onClick={() => copy("overlay", overlayCode)}>{copied === "overlay" ? "복사됨" : "코드 복사"}</button>
      </div>
      <p className="muted">
        회원가입 없이, 고정된 오버레이 시크릿 하나로 <code>/overlay</code> 네임스페이스에 연결합니다.
        연결 후 10초 안에 <code>subscribe</code> 이벤트로 시크릿과 구독할 스트리머 배열을 같이 보내야 합니다.
      </p>
      <div className="guide-steps">
        <code>Socket 서버: http://5.104.82.219:3000/overlay</code>
      </div>
      <pre><code>{overlayCode}</code></pre>

      <div className="title"><h2>REST 폴링 예시</h2></div>
      <p className="muted">GET /donations/polling — cursor 미입력 시 최신 데이터부터 반환합니다.</p>
      <pre><code>{pollingCode}</code></pre>
    </section>
  );
}
