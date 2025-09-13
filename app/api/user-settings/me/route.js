// app/api/user-settings/me/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

/** 토큰에서 사용자 확인 */
async function requireUser(req) {
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE
  );
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) throw new Error("unauthorized");
  const { data, error } = await supa.auth.getUser(auth);
  if (error || !data?.user?.id) throw new Error("unauthorized");
  return { supa, user: data.user };
}

export async function GET(req) {
  try {
    const { supa, user } = await requireUser(req);

    // 내 줄만 조회
    let { data: row, error } = await supa
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // 없으면 기본행 생성
    if (!row) {
      const init = {
        user_id: user.id,
        yearly_budget: 0,
        nickname: null,
        notify_enabled: true,
      };
      const ins = await supa.from("user_settings").insert(init).select().single();
      if (ins.error) throw ins.error;
      row = ins.data;
    }

    return Response.json({ ok: true, data: row }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e?.message || String(e);
    const status = msg === "unauthorized" ? 401 : 500;
    return Response.json({ ok: false, error: msg }, { status });
  }
}
