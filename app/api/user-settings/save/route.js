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
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(raw)) {
    throw new Error("Bad NEXT_PUBLIC_SUPABASE_URL");
  }
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
    // ★ 이 헤더로 PostgREST가 request.jwt.claim.* 를 인식 → RLS의 jwt_uid()가 동작
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const yearly_budget = Number(body?.yearly_budget || 0);

    // 1) Authorization 헤더 우선
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (token) {
      const supa = createDbClientWithJwt(token);

      // 토큰으로 유저 확인(전역 헤더에 이미 실려있으므로 인자 없이 호출)
      const { data: userRes, error: ue } = await supa.auth.getUser();
      if (ue) throw ue;
      if (!userRes?.user) {
        return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
          status: 401,
          headers: { "x-supabase-url": SUPA_URL },
        });
      }

      // ★ RLS-세이프: SECURITY DEFINER RPC 사용
      const { error } = await supa.rpc("set_my_yearly_budget", { new_budget: yearly_budget });
      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "cache-control": "no-store", "x-supabase-url": SUPA_URL },
      });
    }

    // 2) 헤더 없으면 쿠키 기반 세션
    const supaCookie = createRouteHandlerClient({ cookies });
    const { data: { user }, error: ue } = await supaCookie.auth.getUser();
    if (ue) throw ue;
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "x-supabase-url": SUPA_URL },
      });
    }

    const { error } = await supaCookie.rpc("set_my_yearly_budget", { new_budget: yearly_budget });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "cache-control": "no-store", "x-supabase-url": SUPA_URL },
    });
  } catch (e) {
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status,
      headers: { "x-supabase-url": SUPA_URL },
    });
  }
}
