// /lib/supaClient.js
"use client";

import { createClient } from "@supabase/supabase-js";

const URL  = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const ANON = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
if (!/^https:\/\/.+\.supabase\.co\/?$/.test(URL)) {
  throw new Error("Bad/Missing NEXT_PUBLIC_SUPABASE_URL");
}
if (!ANON) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

/** 브라우저에서만 생성하는 하드-싱글톤 */
export function getBrowserClient() {
  if (typeof window === "undefined") {
    // 서버 코드에서 잘못 import 하면 바로 알기
    throw new Error("getBrowserClient() must be called in the browser");
  }
  const g = window;

  // 이미 만들어졌으면 그대로 재사용
  if (g.__SB_CLIENT__) return g.__SB_CLIENT__;

  // 새로 만들 때, 디버그 정보 남김 (중복 원인 추적용)
  const where =
    new Error().stack?.split("\n").slice(1, 4).join("\n") || "no-stack";

  g.__SB_CLIENT__ = createClient(URL.replace(/\/$/, ""), ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: `sb-${URL.match(/https:\/\/([^.]*)/)[1]}-auth-token`,
    },
  });
  g.__SB_CLIENT_CREATED_AT__ = { at: new Date().toISOString(), where };

  if (process.env.NODE_ENV !== "production") {
    console.log("[supa] created once", g.__SB_CLIENT_CREATED_AT__);
  }
  return g.__SB_CLIENT__;
}

// 기존 코드와 호환용 기본 export
export const supa = getBrowserClient();
