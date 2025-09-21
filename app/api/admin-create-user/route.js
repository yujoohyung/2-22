import { supa } from "@/lib/supaClient";

export async function POST(req) {
  try {
    const { email, password, adminSecret } = await req.json();

    // ✅ 공백/개행 제거 후 비교 (한글·복사실수 대비)
    const ADMIN_CODE = (process.env.ADMIN_CREATE_CODE || "").trim();
    const INPUT_CODE  = (adminSecret || "").trim();

    if (!INPUT_CODE || INPUT_CODE !== ADMIN_CODE) {
      return new Response(JSON.stringify({ error: "invalid-admin-code" }), { status: 401 });
    }

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "이메일/비밀번호를 입력하세요." }), { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message || String(error) }), { status: 400 });
    }

    const { error: insertError } = await supabaseAdmin
      .from("allowed_emails")
      .insert({ email });

    if (insertError) {
      return new Response(JSON.stringify({ message: "계정 생성 성공 (허용 이메일 등록 실패)", data }), { status: 200 });
    }

    return new Response(JSON.stringify({ message: "계정 생성 & 허용 이메일 등록 완료", data }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500 });
  }
}
