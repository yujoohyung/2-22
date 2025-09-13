// app/api/price/last/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol");
    if (!symbol) {
      return new Response(JSON.stringify({ ok: false, error: "symbol required" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    const { data, error } = await supa
      .from("prices")
      .select("close, ts")
      .eq("symbol", symbol)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return new Response(JSON.stringify({ ok: false, error: "no price" }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, price: Number(data.close), asOf: data.ts }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
