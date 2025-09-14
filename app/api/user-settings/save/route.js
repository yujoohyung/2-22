// app/api/user-settings/save/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

/** 요청 토큰을 DB에도 전파하는 서버용 클라 생성 */
function createServerSupaWithJwt(token) {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url) throw new Error("Missing env: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL");
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) throw new Error("Bad SUPABASE_URL");
  if (!anon) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");

  // 이 클라로 수행하는 모든 DB 요청에 Authorization 헤더가 실려감 → RLS의 jwt_uid()가 동작
  return createClient(url.replace(/\/$/, ""), anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function POST(req) {
  try {
    // 1) Authorization 헤더에서 토큰 추출
    const authHdr = req.headers.get("authorization") || "";
    const token = authHdr.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    }

    // 2) 토큰 검증 → user
    const supaAuthOnly = createClient(
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, ""),
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()
    );
    const { data: userRes, error: ue } = await supaAuthOnly.auth.getUser(token);
    if (ue) throw ue;
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    }

    // 3) 본문 파싱
    const body = await req.json().catch(() => ({}));
    const yearly_budget = Number(body?.yearly_budget || 0);

    // 4) DB 작업은 "JWT 전파된" 클라로 실행 (RLS 통과)
    const supa = createServerSupaWithJwt(token);
    const { error } = await supa
      .from("user_settings")
      .upsert(
        {
          user_id: user.id,
          yearly_budget,
        },
        { onConflict: "user_id" }
      );
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
