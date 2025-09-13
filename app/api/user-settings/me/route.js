// app/api/user-settings/me/route.js
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 헤더의 Bearer 토큰에서 사용자 확인 (서버에서 검증)
async function getUserFromAuthHeader(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE, // Admin 권한으로 토큰 검증
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function GET(req) {
  try {
    const user = await getUserFromAuthHeader(req);
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401, headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
    const { data, error } = await db
      .from("user_settings")
      .select("user_id, user_email, yearly_budget, deposit, basket, stage_amounts_krw, stage_amounts_by_symbol, notify_enabled, nickname")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    // 없으면 기본값
    const row = data || {
      user_id: user.id,
      user_email: user.email ?? null,
      yearly_budget: 0,
      deposit: 0,
      basket: [{ symbol: "nasdaq2x", weight: 0.6 }, { symbol: "bigtech2x", weight: 0.4 }],
      stage_amounts_krw: null,
      stage_amounts_by_symbol: null,
      notify_enabled: true,
      nickname: null,
    };

    return new Response(JSON.stringify({ ok: true, data: row }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
