"use client";
import { createClient } from "@supabase/supabase-js";

const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const anon   = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
if (!rawUrl) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
if (!/^https:\/\/.+\.supabase\.co\/?$/.test(rawUrl)) throw new Error("Bad NEXT_PUBLIC_SUPABASE_URL");
if (!anon) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");
const url = rawUrl.replace(/\/$/, "");

function getClient() {
  if (typeof window === "undefined") return createClient(url, anon);
  if (!window.__supa) window.__supa = createClient(url, anon);
  return window.__supa;
}
export const supa = getClient();

// 세션 변동 시 서버쿠키 동기화
let t = null;
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
