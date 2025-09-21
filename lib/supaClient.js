// /lib/supaClient.js
"use client";

import { createClient } from "@supabase/supabase-js";

const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const anon   = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

if (!rawUrl) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
if (!/^https:\/\/.+\.supabase\.co\/?$/.test(rawUrl)) {
  throw new Error("Bad env: NEXT_PUBLIC_SUPABASE_URL must look like https://xxxxx.supabase.co");
}
if (!anon) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");

const url = rawUrl.replace(/\/$/, "");

// ✅ 브라우저 탭당 싱글톤 (Multiple GoTrueClient 경고 방지)
function getClient() {
  if (typeof window === "undefined") {
    // SSR 중 클라이언트 훅에서 호출될 수 있으니, 임시 인스턴스 허용
    return createClient(url, anon);
  }
  if (!window.__supa) {
    window.__supa = createClient(url, anon);
  }
  return window.__supa;
}

export const supa = getClient();

// ✅ 세션 변화 → 서버 쿠키 동기화
let syncTimer = null;
supa.auth.onAuthStateChange(async (event, session) => {
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
    } catch {
      // 네트워크 일시 오류는 조용히 무시
    }
  }, 150);
});
