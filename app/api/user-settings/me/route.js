// app/api/user-settings/me/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireUser } from "../../../lib/auth-server.js";

export async function GET(req) {
  try {
    const { supa, user } = await requireUser(req);

    let { data: row, error } = await supa
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;

    if (!row) {
      const init = {
        user_id: user.id,
        notify_enabled: true,
        yearly_budget: 0,
        basket: [],
        stage_amounts_krw: [120000, 240000, 552000],
      };
      const ins = await supa.from("user_settings").insert(init).select().single();
      if (ins.error) throw ins.error;
      row = ins.data;
    }

    return Response.json({ ok: true, data: row }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return Response.json({ ok: false, error: msg }, { status });
  }
}
