// app/api/auth/signup/route.js
import "server-only";
import { supa } from "@/lib/supaClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Body: { adminCode, email, password }
 * - adminCode 는 서버에서만 검증 (ENV: ADMIN_CREATE_CODE)
 * - 성공 시 즉시 로그인 가능하도록 email_confirm: true 로 생성
 */
export async function POST(req) {
  try {
    const { adminCode, email, password } = await req.json().catch(() => ({}));

    if (!adminCode || !email || !password) {
      return new Response(JSON.stringify({ ok: false, error: "필수값 누락" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // ✅ 서버 전용 ENV로 관리자 코드 검증
    if (adminCode !== process.env.ADMIN_CREATE_CODE) {
      return new Response(JSON.stringify({ ok: false, error: "관리자 코드가 올바르지 않습니다." }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // 간단한 유효성
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: "이메일 형식이 올바르지 않습니다." }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (String(password).length < 6) {
      return new Response(JSON.stringify({ ok: false, error: "비밀번호는 6자 이상 입력하세요." }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // ✅ Service Role 키로 Admin API 사용 (클라이언트에서 절대 사용 금지!)
    const supaAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 이미 존재해도 에러가 날 수 있으므로, 메시지 받아서 그대로 전달
    const { data, error } = await supaAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // 바로 로그인 가능
      user_metadata: { role: "member", created_by: "signup-form" },
    });

    if (error) {
      // 대표적인 메시지 정리
      const msg =
        error.message?.includes("already registered") ? "이미 가입된 이메일입니다." :
        error.message || "회원 생성 중 오류가 발생했습니다.";
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({ ok: true, userId: data.user?.id || null }), {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
