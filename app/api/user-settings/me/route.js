// app/api/user-settings/me/route.js
import "server-only";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const { user, supa } = await requireUser(req);
    const { data, error } = await supa
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    // 없으면 빈 객체
    return Response.json({ ok: true, data: data || {} });
  } catch (e) {
    const msg = e?.message || String(e);
    const code = /unauthorized/i.test(msg) ? 401 : 500;
    return Response.json({ ok: false, error: msg }, { status: code });
  }
}
