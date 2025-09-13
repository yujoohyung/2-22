// app/api/user-settings/save/route.js
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUserFromAuthHeader(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function POST(req) {
  try {
    const user = await getUserFromAuthHeader(req);
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401, headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    const body = await req.json().catch(() => ({}));
    const yearly_budget = Number(body?.yearly_budget ?? 0) || 0;

    // 기본 바스켓(없으면 생성시 함께 저장)
    const basket = Array.isArray(body?.basket) && body.basket.length
      ? body.basket
      : [{ symbol: "nasdaq2x", weight: 0.6 }, { symbol: "bigtech2x", weight: 0.4 }];

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    // user_id PK로 upsert (계정마다 완전 분리)
    const { error } = await db.from("user_settings").upsert({
      user_id: user.id,
      user_email: user.email ?? null,
      yearly_budget,
      deposit: yearly_budget, // 화면과 호환 위해 동기화
      basket
    }, { onConflict: "user_id" });

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
