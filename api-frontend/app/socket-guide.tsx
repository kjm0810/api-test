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

export default function SocketGuide() {
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="panel socket-guide">
      <div className="title">
        <div><p className="eyebrow">SOCKET.IO GUIDE</p><h2>실시간 이벤트 연결</h2></div>
        <button className="secondary" onClick={() => copy(code)}>{copied ? "복사됨" : "코드 복사"}</button>
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
      <div className="title"><h2>REST 폴링</h2></div>
      <p className="muted">GET /donations/polling — cursor 미입력 시 최신 데이터부터 반환합니다.</p>
      <pre><code>{pollingCode}</code></pre>
    </section>
  );
}
