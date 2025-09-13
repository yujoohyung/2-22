// app/api/user-settings/save/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

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

export async function POST(req) {
  try {
    const { supa, user } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const yearly = Number(body?.yearly_budget ?? 0);
    if (!Number.isFinite(yearly) || yearly < 0) {
      return Response.json({ ok: false, error: "invalid yearly_budget" }, { status: 400 });
    }

    // 존재여부 확인
    const exist = await supa.from("user_settings").select("user_id").eq("user_id", user.id).maybeSingle();

    if (!exist.data) {
      // 없으면 생성
      const ins = await supa.from("user_settings").insert({
        user_id: user.id,
        yearly_budget: yearly,
        notify_enabled: true,
      }).select().single();
      if (ins.error) throw ins.error;
      return Response.json({ ok: true, data: ins.data });
    } else {
      // 있으면 업데이트 (내 줄만!)
      const upd = await supa
        .from("user_settings")
        .update({ yearly_budget: yearly, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .select()
        .single();
      if (upd.error) throw upd.error;
      return Response.json({ ok: true, data: upd.data });
    }
  } catch (e) {
    const msg = e?.message || String(e);
    const status = msg === "unauthorized" ? 401 : 500;
    return Response.json({ ok: false, error: msg }, { status });
  }
}
