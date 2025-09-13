// app/api/user-settings/save/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireUser } from "../../../lib/auth-server.js";

export async function POST(req) {
  try {
    const { supa, user } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const yearly = Number(body?.yearly_budget ?? 0);
    if (!Number.isFinite(yearly) || yearly < 0) {
      return Response.json({ ok: false, error: "invalid yearly_budget" }, { status: 400 });
    }

    const exist = await supa
      .from("user_settings")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (exist.error) throw exist.error;

    if (!exist.data) {
      const ins = await supa
        .from("user_settings")
        .insert({
          user_id: user.id,
          yearly_budget: yearly,
          notify_enabled: true,
        })
        .select()
        .single();
      if (ins.error) throw ins.error;
      return Response.json({ ok: true, data: ins.data });
    }

    const upd = await supa
      .from("user_settings")
      .update({ yearly_budget: yearly, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .select()
      .single();
    if (upd.error) throw upd.error;

    return Response.json({ ok: true, data: upd.data });
  } catch (e) {
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return Response.json({ ok: false, error: msg }, { status });
  }
}
