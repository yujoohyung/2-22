// /app/api/auth/signup/route.js
import "server-only";
import { NextResponse } from "next/server";
import { getServiceClient } from "../../../../lib/auth-server.js"; // ✅ 상대경로 주의!

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signup
 * Body: { adminCode, email, password }
 * - ADMIN_CREATE_CODE 일치해야 생성
 * - Service Role 키로 Supabase Admin API 사용 (서버 ONLY)
 * - 생성 후 user_settings 에 초기 레코드 업서트
 */
export async function POST(req) {
  try {
    const { adminCode, email, password } = await req.json().catch(() => ({}));

    // 1) 입력 검증
    if (!adminCode || !email || !password) {
      return NextResponse.json({ ok: false, error: "필수값 누락" }, { status: 400 });
    }
    if (adminCode !== process.env.ADMIN_CREATE_CODE) {
      return NextResponse.json({ ok: false, error: "관리자 코드가 올바르지 않습니다." }, { status: 401 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return NextResponse.json({ ok: false, error: "이메일 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (String(password).length < 6) {
      return NextResponse.json({ ok: false, error: "비밀번호는 6자 이상 입력하세요." }, { status: 400 });
    }

    // 2) 서버 전용 Service Role 클라이언트
    const supaAdmin = getServiceClient();

    // 3) Admin API로 사용자 생성 (이메일 즉시 확인 처리)
    const { data, error } = await supaAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "member", created_by: "signup-form" },
    });

    if (error) {
      const msg =
        /already registered/i.test(error.message)
          ? "이미 가입된 이메일입니다."
          : error.message || "회원 생성 중 오류가 발생했습니다.";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    const userId = data?.user?.id;

    // 4) 사용자 설정 초기값 업서트 (없으면 생성)
    if (userId) {
      const { error: upsertErr } = await supaAdmin
        .from("user_settings")
        .upsert(
          {
            user_id: userId,
            user_email: email,
            notify_enabled: true,
            yearly_budget: 0,
            basket: [],
            stage_amounts_krw: [0, 0, 0],
            stage_amounts_by_symbol: {},
          },
          { onConflict: "user_id" }
        );
      if (upsertErr) {
        // 초기 설정 업서트 실패해도 회원은 생성됐으니 207로 부분 성공 알림
        return NextResponse.json(
          { ok: true, userId, warn: "user_settings 업서트 실패: " + upsertErr.message },
          { status: 207 }
        );
      }
    }

    return NextResponse.json({ ok: true, userId }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
