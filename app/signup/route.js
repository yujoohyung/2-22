import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { adminCode, email, password } = await req.json();

    if (!adminCode || !email || !password) {
      return new Response(JSON.stringify({ ok: false, error: "missing fields" }), {
        status: 400, headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (adminCode !== process.env.ADMIN_CREATE_CODE) {
      return new Response(JSON.stringify({ ok: false, error: "invalid admin code" }), {
        status: 403, headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 1) 허용 목록에 등록(이미 있으면 그대로)
    await supa.from("allowed_emails").upsert(
      { email },
      { onConflict: "email" }
    );

    // 2) Supabase 사용자 생성(이미 있으면 통과로 간주)
    const { error: uerr } = await supa.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // 메일 인증 스킵
    });
    if (uerr && !String(uerr.message || "").toLowerCase().includes("already")) {
      throw uerr;
    }

    // 3) settings 기본 행 보장(없으면 생성)
    await supa.from("settings").upsert(
      {
        user_email: email,
        deposit: 0,
        rsi_period: 14,
        rsi_levels: { buy: [43, 36, 30], rebalance: 55 },
        ladder: { buy_pct: [0.06, 0.06, 0.08] },
      },
      { onConflict: "user_email" }
    );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e.message || e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
