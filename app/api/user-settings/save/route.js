// app/api/user-settings/save/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

/** 서버용 supabase (URL은 SUPABASE_URL 우선, 없으면 NEXT_PUBLIC_SUPABASE_URL 폴백) */
function createServerSupa() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url) throw new Error("Missing env: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL");
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) throw new Error("Bad SUPABASE_URL");
  if (!anon) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url.replace(/\/$/, ""), anon);
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
    const supa = createServerSupa();
    const { data: userRes, error: ue } = await supa.auth.getUser(token);
    if (ue) throw ue;
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    }

    // 3) 본문 파싱
    const body = await req.json().catch(() => ({}));
    const yearly_budget = Number(body?.yearly_budget || 0);

    // 4) upsert (RLS: user_id = auth.uid() 정책 필요)
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
