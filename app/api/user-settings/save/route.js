import "server-only";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { user, supa } = await requireUser(req);
    const { yearly_budget } = await req.json().catch(() => ({}));
    const yb = Number(yearly_budget ?? 0);

    // 1) RPC
    const { error: rpcErr } = await supa.rpc("upsert_my_user_settings", { new_budget: yb });
    if (!rpcErr) return Response.json({ ok: true, via: "rpc" });

    // 2) 폴백(정책이 auth.uid()와 맞으면 이것도 통과)
    const { error: upErr } = await supa
      .from("user_settings")
      .upsert({ user_id: user.id, yearly_budget: yb, notify_enabled: true }, { onConflict: "user_id" });

    if (upErr) throw upErr;
    return Response.json({ ok: true, via: "fallback-upsert" });
  } catch (e) {
    console.error("[user-settings/save] ERR:", e);
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
