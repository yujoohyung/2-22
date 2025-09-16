// lib/supaClient.js
import { createClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) throw new Error("Supabase env missing");

// ❗앱 전역에서 이 인스턴스만 import해서 쓰세요
export const supa = createClient(url, anon);

// 브라우저에서만 세션 변경 시 서버 쿠키 동기화
if (typeof window !== "undefined") {
  // HMR/중복 등록 방지
  const FLAG = "__supa_auth_sync_registered__";
  if (!window[FLAG]) {
    window[FLAG] = true;

    supa.auth.onAuthStateChange(async (event, session) => {
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
      } catch {/* no-op */}
    });
  }
}
