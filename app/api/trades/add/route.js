// app/api/trades/add/route.js
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * body: { symbol: string, date: string(YYYY-MM-DD), price: number, qty: number, side: 'BUY'|'SELL' }
 * 로그인 필수 / user_trades에 user_id=auth.uid()로 기록 (RLS 정책과 일치)
 */
export async function POST(req) {
  try {
    const { symbol, date, price, qty, side } = await req.json();
    if (!symbol || !date || !Number(price) || !Number(qty) || !["BUY", "SELL"].includes(side)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid payload" }), { status: 400 });
    }

    const supa = createRouteHandlerClient({ cookies });

    // 로그인 사용자
    const { data: { user }, error: ue } = await supa.auth.getUser();
    if (ue) throw ue;
    if (!user) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });

    const { error } = await supa.from("user_trades").insert({
      user_id: user.id,
      symbol,
      date,
      price,
      qty,
      side,
    });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500 });
  }
}
