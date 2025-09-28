"use client";
import { createClient } from "@supabase/supabase-js";

const url  = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");

if (!url || !anon) throw new Error("Supabase env missing");

export const supa = (() => {
  if (typeof window === "undefined") return createClient(url, anon);
  if (!window.__supa) window.__supa = createClient(url, anon);
  return window.__supa;
})();

// 로그인/로그아웃/리프레시 → 서버 쿠키 동기화
let t;
supa.auth.onAuthStateChange((event, session) => {
  clearTimeout(t);
  t = setTimeout(() => {
    fetch("/auth/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event,
        access_token: session?.access_token || null,
        refresh_token: session?.refresh_token || null,
      }),
    }).catch(() => {});
  }, 150);
});
