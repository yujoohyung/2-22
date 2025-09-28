// /lib/supaClient.js
"use client";

import { createClient } from "@supabase/supabase-js";

let _client = null;

function getEnv() {
  const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon   = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!rawUrl) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(rawUrl)) {
    throw new Error("Bad env: NEXT_PUBLIC_SUPABASE_URL must look like https://xxxxx.supabase.co");
  }
  if (!anon) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url: rawUrl.replace(/\/$/, ""), anon };
}

/** 브라우저에서만 호출하세요. (SSR/빌드에서 호출 금지) */
export function getBrowserClient() {
  if (typeof window === "undefined") {
    throw new Error("getBrowserClient() must be called in the browser");
  }
  if (_client) return _client;

  // 탭 단위 싱글톤
  if (!window.__SB_CLIENT__) {
    const { url, anon } = getEnv();
    window.__SB_CLIENT__ = createClient(url, anon);
    // 세션 변화 → 서버 쿠키 동기화 (디바운스)
    let syncTimer = null;
    window.__SB_CLIENT__.auth.onAuthStateChange(async (event, session) => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(async () => {
        try {
          await fetch("/auth/set", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              event,
              access_token: session?.access_token || null,
              refresh_token: session?.refresh_token || null,
            }),
          });
        } catch {}
      }, 150);
    });
  }
  _client = window.__SB_CLIENT__;
  return _client;
}

/** 토큰만 필요할 때 쓰는 헬퍼 (브라우저에서만 호출) */
export async function getAccessToken() {
  const supa = getBrowserClient();
  const { data } = await supa.auth.getSession();
  return data?.session?.access_token || null;
}
