// app/auth/set/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

/**
 * 클라이언트(SPA)에서 받은 Supabase 세션을
 * 서버 쿠키(auth-helpers가 읽는 쿠키)와 동기화한다.
 *
 * 기대 payload:
 * { event: "SIGNED_IN" | "TOKEN_REFRESHED" | "SIGNED_OUT" | string,
 *   session?: { access_token, refresh_token, ... },
 *   access_token?: string,
 *   refresh_token?: string }
 */
export async function POST(req) {
  const ck = cookies();
  const supa = createRouteHandlerClient({ cookies: ck });

  try {
    const payload = await req.json().catch(() => ({}));
    const event = String(payload?.event || "").toUpperCase();

    // 1) 로그아웃/유저삭제 → 서버 쿠키 정리
    if (event === "SIGNED_OUT" || event === "USER_DELETED") {
      await supa.auth.signOut(); // 서버 쿠키 제거
      return new Response(JSON.stringify({ ok: true, cleared: true }), {
        status: 200,
        headers: { "cache-control": "no-store", "x-auth-sync": "signed_out" },
      });
    }

    // 2) 세션 설정(우선순위: 명시적 토큰 → session 객체)
    const at =
      payload?.access_token ||
      payload?.session?.access_token ||
      null;
    const rt =
      payload?.refresh_token ||
      payload?.session?.refresh_token ||
      null;

    if (at && rt) {
      const { error } = await supa.auth.setSession({ access_token: at, refresh_token: rt });
      if (error) throw error;

      return new Response(JSON.stringify({ ok: true, set: true }), {
        status: 200,
        headers: { "cache-control": "no-store", "x-auth-sync": "set_session" },
      });
    }

    // 3) 토큰이 없으면 잘못된 요청
    return new Response(JSON.stringify({ ok: false, error: "bad_payload" }), {
      status: 400,
      headers: { "cache-control": "no-store", "x-auth-sync": "bad_payload" },
    });
  } catch (e) {
    const msg = e?.message || String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "cache-control": "no-store", "x-auth-sync": "error" },
    });
  }
}
