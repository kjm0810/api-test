"use client";

import { useEffect, useState } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://5.104.82.219:3000";

export function useAuth() {
  const [accessToken, setAccessToken] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    setApiKey(localStorage.getItem("streamApiKey") ?? "");
    setAccessToken(localStorage.getItem("streamAccessToken") ?? "");
  }, []);

  const setAuth = (token: string, key?: string) => {
    setAccessToken(token);
    localStorage.setItem("streamAccessToken", token);
    if (key) updateApiKey(key);
  };

  const updateApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("streamApiKey", key);
  };

  const logout = () => {
    localStorage.removeItem("streamAccessToken");
    setAccessToken("");
  };

  const request = async (path: string, init?: RequestInit) => {
    const headers = { "x-api-key": apiKey, authorization: accessToken ? `Bearer ${accessToken}` : "", "content-type": "application/json" };
    const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  };

  return { accessToken, apiKey, setAuth, updateApiKey, logout, request };
}
