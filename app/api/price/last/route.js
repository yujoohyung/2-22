import { createClient } from "@supabase/supabase-js";
import { calcRSI } from "@/lib/rsi";

export async function GET(req) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "005930";
  const period = Number(url.searchParams.get("period") || 14);
  const limit = Number(url.searchParams.get("limit") || 200);

  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
  const { data, error } = await supa.from("prices")
    .select("ts, close").eq("symbol", symbol)
    .order("ts", { ascending: false }).limit(limit);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const arr = (data || []).sort((a,b)=> new Date(a.ts) - new Date(b.ts));
  const closes = arr.map(x => Number(x.close));
  const rsi = calcRSI(closes, period);
  return new Response(JSON.stringify({ items: arr, rsi }), { status: 200 });
}
