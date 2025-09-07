import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ allowed: false, error: "missing email" }), {
        status: 400, headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    const { data, error } = await supa
      .from("allowed_emails")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (error) throw error;

    return new Response(JSON.stringify({ allowed: !!data }), {
      status: 200, headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ allowed: false, error: String(e.message || e) }), {
      status: 500, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
