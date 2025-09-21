// /lib/saveUserSettings.js
"use client";

import { supa } from "./supaClient";

export async function saveUserSettings(payload) {
  const safe = (v) => (v === undefined ? null : v);
  const body = {
    yearly_budget: Number(payload?.yearly_budget || 0),
  };

  // 토큰 붙일 수 있으면 붙이고, 아니면 쿠키 인증에 맡김
  let headers = { "content-type": "application/json" };
  try {
    const { data } = await supa.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers = { ...headers, Authorization: `Bearer ${token}` };
  } catch {}

  const res = await fetch("/api/user-settings/save", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json ?? { ok: true };
}
