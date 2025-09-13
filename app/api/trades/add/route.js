export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { normSymbol } from "../../../../lib/symbols";

function normDate(s) {
  if (!s) return null;
  const t = String(s).replace(/[^0-9]/g, "");
  if (t.length !== 8) return null;
  return `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`;
}

/**
 * body: { symbol: string (dashboard|stock2|NASDAQ2X|BIGTECH2X), date: 'YYYY-MM-DD'|'YYYYMMDD', price: number, qty: number, side: 'BUY'|'SELL' }
 */
export async function POST(req) {
  try {
    const supa = createRouteHandlerClient({ cookies });
    const { data: { user }, error: ue } = await supa.auth.getUser();
    if (ue) throw ue;
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    }

    const { symbol: rawSym, date, price, qty, side } = await req.json();
    const symbol = normSymbol(rawSym || "");
    const d = normDate(date) || normDate(new Date().toISOString().slice(0,10)) || new Date().toISOString().slice(0,10);
    const priceN = Number(price);
    const qtyN = Math.floor(Number(qty));

    if (!symbol || !["BUY", "SELL"].includes(String(side || "").toUpperCase())) {
      return new Response(JSON.stringify({ ok: false, error: "invalid symbol/side" }), { status: 400 });
    }
    if (!(Number.isFinite(priceN) && priceN > 0 && Number.isFinite(qtyN) && qtyN >= 1)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid price/qty" }), { status: 400 });
    }

    const { error } = await supa.from("user_trades").insert({
      user_id: user.id,
      symbol,
      date: d,
      price: priceN,
      qty: qtyN,
      side: String(side).toUpperCase(),
    });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
}
