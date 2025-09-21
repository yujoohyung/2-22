import "server-only";
import { supa } from "@/lib/supaClient";

export async function POST(req) {
  try {
    const { symbol, ts, close } = await req.json();
    if (!symbol || close == null) {
      return new Response(JSON.stringify({ error: "symbol/close required" }), { status: 400 });
    }
    const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
    const when = ts ? new Date(ts) : new Date();
    const { error } = await supa.from("prices").insert({ symbol, ts: when.toISOString(), close });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
