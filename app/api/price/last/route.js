// app/api/price/last/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import "server-only";
import { supa } from "@/lib/supaClient";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol");
    if (!symbol) {
      return new Response(JSON.stringify({ ok: false, error: "symbol required" }), { status: 400 });
    }

    const supa = getServiceClient();

    const { data, error } = await supa
      .from("prices")
      .select("close, ts")
      .eq("symbol", symbol)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return new Response(JSON.stringify({ ok: false, error: "no price" }), { status: 404 });

    return new Response(JSON.stringify({ ok: true, price: Number(data.close), asOf: data.ts }), {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
}
