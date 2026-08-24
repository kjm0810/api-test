"use client";

import { FormEvent, ReactNode, useState } from "react";
import { API } from "../lib/useAuth";

export default function AuthGate({ accessToken, onAuth, children }: {
  accessToken: string;
  onAuth: (token: string, apiKey?: string) => void;
  children: ReactNode;
}) {
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (accessToken) return <>{children}</>;

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch(`${API}/auth/${authMode}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(authMode === "signup" ? { name, email, password } : { email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "인증 실패");
      onAuth(data.accessToken, data.apiKey);
    } catch (e) { setError(e instanceof Error ? e.message : "인증 실패"); }
  };

  return (
    <main className="auth-page">
      <section className="panel auth">
        <p className="eyebrow">STREAM EVENT API</p>
        <h1>{authMode === "login" ? "로그인" : "회원가입"}</h1>
        <p className="muted">SOOP · 치지직 이벤트 API를 시작하세요.</p>
        <form onSubmit={submitAuth}>
          {authMode === "signup" && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" required />}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" required />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 (8자 이상)" required />
          <button>{authMode === "login" ? "로그인" : "가입하고 API 키 발급"}</button>
        </form>
        {error && <div className="error">{error}</div>}
        <button className="link" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
          {authMode === "login" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
        </button>
      </section>
    </main>
  );
}
