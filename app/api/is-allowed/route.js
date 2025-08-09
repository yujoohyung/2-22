import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ allowed:false, error:"no-email" }), { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE  // RLS 우회 (서버 전용)
    );

    // citext이면 대소문자 자동 무시, text면 lower 비교
    const { data, error } = await supabaseAdmin
      .from("allowed_emails")
      .select("email")
      .eq("email", email.trim())
      .limit(1);

    if (error) {
      return new Response(JSON.stringify({ allowed:false, error: error.message }), { status: 500 });
    }

    const allowed = Array.isArray(data) && data.length > 0;
    return new Response(JSON.stringify({ allowed }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ allowed:false, error: e.message }), { status: 500 });
  }
}
