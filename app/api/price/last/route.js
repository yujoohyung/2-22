// app/api/prices/update/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import { normSymbol } from "../../../../lib/symbols";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawSymbol = body?.symbol;
    const close = body?.close;

    if (!rawSymbol || close == null) {
      return new Response(JSON.stringify({ ok: false, error: "symbol/close required" }), { status: 400 });
    }

    const symbol = normSymbol(rawSymbol); // ✅ 심볼 표준화
    const when = body?.ts ? new Date(body.ts) : new Date();

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    const { error } = await supa.from("prices").insert({
      symbol,
      ts: when.toISOString(),
      close: Number(close),
    });

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
}
