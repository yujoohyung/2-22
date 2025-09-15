// app/api/user-settings/save/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

/* ===== env 유틸 ===== */
function getUrl() {
  const raw = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!raw) throw new Error("Missing SUPABASE_URL");
  return raw.replace(/\/$/, "");
}
function getAnon() {
  const k = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!k) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return k;
}
function createDbClientWithJwt(token) {
  return createClient(getUrl(), getAnon(), {
    // ★ 이 헤더가 있어야 postgres에서 request.jwt.claim.sub를 읽음
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
      // 헤더 토큰으로 인증 + 동일 JWT 전파 클라 생성
      const supa = createDbClientWithJwt(token);
      const { data: userRes, error: ue } = await supa.auth.getUser(); // token은 전역 헤더로 이미 전달됨
      if (ue) throw ue;
      if (!userRes?.user) {
        return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
      }

      // ★ RLS-우회 보안 함수 사용
      const { error } = await supa.rpc("set_my_yearly_budget", { new_budget: yearly_budget });
      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
    }

    // 2) 쿠키 기반(헤더 없을 때)
    const supa = createRouteHandlerClient({ cookies });
    const { data: { user }, error: ue } = await supa.auth.getUser();
    if (ue) throw ue;
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    }

    // ★ 동일하게 RPC로 처리 (쿠키 세션이 있으므로 jwt_uid()가 세팅됨)
    const { error } = await supa.rpc("set_my_yearly_budget", { new_budget: yearly_budget });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), { status });
  }
}
