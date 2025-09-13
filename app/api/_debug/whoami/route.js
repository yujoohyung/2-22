// app/api/_debug/whoami/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireUser } from "../../../../lib/auth-server.js";

export async function GET(req) {
  try {
    const { user } = await requireUser(req);
    return Response.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 401 });
  }
}
