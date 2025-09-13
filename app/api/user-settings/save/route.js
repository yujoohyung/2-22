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

    // 존재 여부
    const exist = await supa
      .from("user_settings")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!exist.data) {
      const ins = await supa.from("user_settings").insert({
        user_id: user.id,
        user_email: user.email || null,
        yearly_budget: yearly,
        deposit: yearly, // 예수금 = 납입금(초기 동기화) 원하면 제거
        notify_enabled: true,
        basket: [],
        stage_amounts_krw: [0,0,0],
        stage_amounts_by_symbol: {},
      }).select().single();
      if (ins.error) throw ins.error;
      return Response.json({ ok: true, data: ins.data });
    } else {
      const upd = await supa
        .from("user_settings")
        .update({
          yearly_budget: yearly,
          updated_at: new Date().toISOString(),
        })
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
