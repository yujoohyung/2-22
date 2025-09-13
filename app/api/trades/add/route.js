// app/api/trades/add/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireUser } from "../../../lib/auth-server.js";

export async function POST(req) {
  try {
    const { supa, user } = await requireUser(req);

    const { symbol, date, price, qty, side } = await req.json();
    if (!symbol || !date || !Number(price) || !Number(qty) || !["BUY", "SELL"].includes(side)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid payload" }), { status: 400 });
    }

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
    const msg = e?.message || String(e);
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), { status });
  }
}
