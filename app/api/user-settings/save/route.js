// app/api/user-settings/save/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

/* ===== 유틸: 서버용 클라 생성 ===== */
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
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const yearly_budget = Number(body?.yearly_budget || 0);

    // 1) 헤더 토큰 우선
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (token) {
      // 토큰 검증
      const supaAuthOnly = createClient(getUrl(), getAnon());
      const { data: userRes, error: ue } = await supaAuthOnly.auth.getUser(token);
      if (ue) throw ue;
      const user = userRes?.user;
      if (!user) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });

      // DB 작업은 JWT 전파 클라로 (RLS: jwt_uid() 통과)
      const supa = createDbClientWithJwt(token);
      const { error } = await supa
        .from("user_settings")
        .upsert({ user_id: user.id, yearly_budget }, { onConflict: "user_id" });
      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "cache-control": "no-store" } });
    }

    // 2) 헤더 없으면 쿠키 기반 세션으로 인증 시도
    const supa = createRouteHandlerClient({ cookies });
    const { data: { user }, error: ue } = await supa.auth.getUser();
    if (ue) throw ue;
    if (!user) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });

    const { error } = await supa
      .from("user_settings")
      .upsert({ user_id: user.id, yearly_budget }, { onConflict: "user_id" });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), { status });
  }
}
