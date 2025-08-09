import { createClient } from "@supabase/supabase-js";

export async function GET(req) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "005930";
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
  const { data, error } = await supa.from("alerts")
    .select("*").eq("symbol", symbol).order("created_at", { ascending: false }).limit(50);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ items: data || [] }), { status: 200 });
}
