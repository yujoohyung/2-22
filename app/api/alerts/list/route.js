import { supa } from "@/lib/supaClient";

export async function GET(req) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "005930";
  const supa = getServiceClient();
  const { data, error } = await supa.from("alerts")
    .select("*").eq("symbol", symbol).order("created_at", { ascending: false }).limit(50);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ items: data || [] }), { status: 200 });
}
