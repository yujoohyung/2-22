// app/api/user-settings/save/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

/* ===== Supabase env (서버/클라 동일 프로젝트 강제) ===== */
function getUrl() {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!raw) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!/^https:\/\/.+\.supabase\.co\/?$/i.test(raw)) throw new Error("Bad NEXT_PUBLIC_SUPABASE_URL");
  return raw.replace(/\/$/, "");
}
function getAnon() {
  const k = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!k) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return k;
}
const SUPA_URL = getUrl();
const SUPA_ANON = getAnon();

function createDbClientWithJwt(token) {
  return createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function POST(req) {
  const diag = { path: "unknown" };

  try {
    const body = await req.json().catch(() => ({}));
    const yearly_budget = Number(body?.yearly_budget || 0);

    // (A) Authorization 헤더 우선
    const authHeader = req.headers.get("authorization") || "";
    const headerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (headerToken) {
      const supa = createDbClientWithJwt(headerToken);
      const { data: userRes } = await supa.auth.getUser(); // 전역 헤더로 검증
      if (!userRes?.user) throw new Error("unauthorized");
      const { error } = await supa.rpc("upsert_my_user_settings", { new_budget: yearly_budget });
      if (error) throw error;
      diag.path = "header";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "cache-control": "no-store", "x-supabase-url": SUPA_URL, "x-auth-path": diag.path },
      });
    }

    // (B) 쿠키에서 sb-access-token 직접 뽑아 JWT 전파
    const ck = cookies();
    const cookieToken = ck.get("sb-access-token")?.value || "";
    if (cookieToken) {
      const supa = createDbClientWithJwt(cookieToken);
      const { data: userRes } = await supa.auth.getUser();
      if (!userRes?.user) throw new Error("unauthorized");
      const { error } = await supa.rpc("upsert_my_user_settings", { new_budget: yearly_budget });
      if (error) throw error;
      diag.path = "cookie-token";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "cache-control": "no-store", "x-supabase-url": SUPA_URL, "x-auth-path": diag.path },
      });
    }

    // (C) 폴백: auth-helpers로 쿠키 세션 사용
    const supaCookie = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supaCookie.auth.getUser();
    if (!user) throw new Error("unauthorized");
    const { error } = await supaCookie.rpc("upsert_my_user_settings", { new_budget: yearly_budget });
    if (error) throw error;
    diag.path = "cookie-helpers";
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "cache-control": "no-store", "x-supabase-url": SUPA_URL, "x-auth-path": diag.path },
    });

  } catch (e) {
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status,
      headers: { "x-supabase-url": SUPA_URL, "x-auth-path": diag.path || "unknown" },
    });
  }
}
