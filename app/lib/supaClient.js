// lib/supaClient.js
"use client";

import { createClient } from "@supabase/supabase-js";

const url  = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

if (!url) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) {
  throw new Error("Bad env: NEXT_PUBLIC_SUPABASE_URL must look like https://xxxxx.supabase.co");
}
if (!anon) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");

// 마지막 슬래시 제거(일관성)
const baseUrl = url.replace(/\/$/, "");

// 브라우저 싱글톤 (Multiple GoTrueClient 방지)
// SSR에서는 매 호출 생성되어도 무방
function getSingleton() {
  if (typeof window === "undefined") return createClient(baseUrl, anon);
  if (!window.__supa) window.__supa = createClient(baseUrl, anon);
  return window.__supa;
}

export const supa = getSingleton();

/* ----------------- 서버 쿠키 동기화 (/auth/set) ----------------- */
async function syncToServer(session, event = "INIT") {
  try {
    await fetch("/auth/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event,
        access_token: session?.access_token ?? null,
        refresh_token: session?.refresh_token ?? null,
      }),
    });
  } catch {}
}

if (typeof window !== "undefined") {
  // 앱 최초 로드시 1회 동기화 (세션 변경 이벤트가 없어도 서버 쿠키를 채움)
  supa.auth.getSession().then(({ data }) => syncToServer(data?.session, "INIT"));

  // HMR/중복 등록 방지 후 상태변경마다 동기화
  if (!window.__supa_auth_sync_registered__) {
    window.__supa_auth_sync_registered__ = true;
    let t = null;
    supa.auth.onAuthStateChange((event, session) => {
      clearTimeout(t);
      t = setTimeout(() => syncToServer(session, event), 120);
    });
  }
}
