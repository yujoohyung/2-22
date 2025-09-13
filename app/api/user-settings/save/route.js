// app/api/user-settings/save/route.js
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
    if (!user) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });

    const { error } = await supa.from("user_settings").upsert({
      user_id: user.id,
      yearly_budget: Number(yearly_budget || 0)
    }, { onConflict: "user_id" });

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500 });
  }
}
