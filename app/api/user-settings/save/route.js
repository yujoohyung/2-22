// app/api/user-settings/save/route.js
import "server-only";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { yearly_budget } = await req.json();

    const supa = createRouteHandlerClient({ cookies });
    const { data: { user }, error: ue } = await supa.auth.getUser();
    if (ue) throw ue;
    if (!user) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // RPC 권장 (RLS 친화)
    const { error } = await supa.rpc("upsert_my_user_settings", {
      new_budget: Number(yearly_budget || 0),
    });
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = /unauthor/i.test(msg) ? 401 : 500;
    return Response.json({ ok: false, error: msg }, { status });
  }
}
