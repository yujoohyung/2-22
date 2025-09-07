import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { adminCode, email, password } = await req.json();

    if (!adminCode || adminCode !== process.env.ADMIN_CREATE_CODE) {
      return new Response(JSON.stringify({ ok:false, error:"invalid-admin-code" }), { status: 403 });
    }
    if (!email || !password) {
      return new Response(JSON.stringify({ ok:false, error:"missing-fields" }), { status: 400 });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE // server role
    );

    // (1) 허용리스트에 등록 (있으면 건너뜀)
    await supa
      .from("allowed_emails")
      .upsert({ email }, { onConflict: "email" });

    // (2) 유저 생성(바로 이메일 확인 처리)
    const { data: created, error: ce } = await supa.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (ce) {
      // 이미 있으면 통과로 간주
      if (!String(ce.message || "").includes("already registered")) {
        return new Response(JSON.stringify({ ok:false, error:ce.message }), { status: 400 });
      }
    }

    // (선택) settings 기본값 1줄 넣고 싶다면 여기에 upsert
    // await supa.from("settings").upsert({ user_email: email, deposit: 0, rsi_levels: { buy:[43,36,30] }, ladder:{ buy_pct:[0.06,0.06,0.08] } });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
