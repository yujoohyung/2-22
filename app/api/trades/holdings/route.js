// app/api/trades/holdings/route.js
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET -> { ok, rows: [{symbol, buy_qty, sell_qty, pos_qty}] }  */
export async function GET() {
  try {
    const supa = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });

    // 한 번에 집계
    const { data, error } = await supa
      .from("user_trades")
      .select("symbol, side, qty")
      .eq("user_id", user.id);
    if (error) throw error;

    const map = new Map();
    for (const r of data || []) {
      const m = map.get(r.symbol) || { buy_qty: 0, sell_qty: 0 };
      if (r.side === "BUY") m.buy_qty += Number(r.qty) || 0;
      else if (r.side === "SELL") m.sell_qty += Number(r.qty) || 0;
      map.set(r.symbol, m);
    }
    const rows = [...map.entries()].map(([symbol, v]) => ({
      symbol,
      buy_qty: v.buy_qty,
      sell_qty: v.sell_qty,
      pos_qty: Math.max(0, v.buy_qty - v.sell_qty),
    }));

    return new Response(JSON.stringify({ ok: true, rows }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500 });
  }
}
