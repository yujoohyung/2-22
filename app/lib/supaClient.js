// lib/supaClient.js
"use client";

import { createClient } from "@supabase/supabase-js";

const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const anon   = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

if (!rawUrl) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");
if (!/^https:\/\/.+\.supabase\.co\/?$/.test(rawUrl)) {
  throw new Error("Bad NEXT_PUBLIC_SUPABASE_URL (https://xxxxx.supabase.co 형식)");
}
if (!anon) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_ANON_KEY");

const url = rawUrl.replace(/\/$/, "");

// 브라우저 탭 내 싱글톤
function getClient() {
  if (typeof window === "undefined") return createClient(url, anon);
  if (!window.__supa) window.__supa = createClient(url, anon);
  return window.__supa;
}
export const supa = getClient();

// ===== 서버 쿠키와 동기화 (/auth/set) =====
let syncTimer = null;

async function postAuthSet(payload) {
  try {
    await fetch("/auth/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {}
}

// ① 앱 처음 로드될 때 현재 세션을 서버로 1회 동기화
(async () => {
  try {
    const { data } = await supa.auth.getSession();
    if (data?.session) {
      await postAuthSet({
        event: "bootstrap",
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    }
  } catch {}
})();

// ② 로그인/토큰갱신/로그아웃 시마다 서버 쿠키 최신화
supa.auth.onAuthStateChange(async (_event, session) => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    postAuthSet({
      event: _event,
      access_token: session?.access_token || null,
      refresh_token: session?.refresh_token || null,
    });
  }, 150);
});
