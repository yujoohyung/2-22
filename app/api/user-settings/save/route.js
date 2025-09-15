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
      diag.path = "header";
      const supa = createDbClientWithJwt(headerToken);

      // ★ 서버에선 반드시 토큰 인자로 넘겨야 함
      const { data: userRes, error: ue } = await supa.auth.getUser(headerToken);
      if (ue) throw ue;
      if (!userRes?.user) throw new Error("unauthorized");

      const { error } = await supa.rpc("upsert_my_user_settings", { new_budget: yearly_budget });
      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "cache-control": "no-store", "x-supabase-url": SUPA_URL, "x-auth-path": diag.path },
      });
    }

    // (B) 쿠키에서 sb-access-token 직접 사용
    const ck = cookies();
    const cookieToken = ck.get("sb-access-token")?.value || "";
    if (cookieToken) {
      diag.path = "cookie-token";
      const supa = createDbClientWithJwt(cookieToken);

      // ★ 여기서도 토큰 인자로 넘김
      const { data: userRes, error: ue } = await supa.auth.getUser(cookieToken);
      if (ue) throw ue;
      if (!userRes?.user) throw new Error("unauthorized");

      const { error } = await supa.rpc("upsert_my_user_settings", { new_budget: yearly_budget });
      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "cache-control": "no-store", "x-supabase-url": SUPA_URL, "x-auth-path": diag.path },
      });
    }

    // (C) 폴백: auth-helpers (쿠키 세션)
    diag.path = "cookie-helpers";
    const supaCookie = createRouteHandlerClient({ cookies });
    const { data: { user }, error: ue } = await supaCookie.auth.getUser();
    if (ue) throw ue;
    if (!user) throw new Error("unauthorized");

    const { error } = await supaCookie.rpc("upsert_my_user_settings", { new_budget: yearly_budget });
    if (error) throw error;

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
