// /app/auth/set/route.js
import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { event, access_token, refresh_token } = await req.json().catch(() => ({}));
    const supa = createRouteHandlerClient({ cookies });

    // 토큰이 있으면 세션 설정, 없거나 로그아웃 이벤트면 세션 제거
    if (access_token && refresh_token) {
      await supa.auth.setSession({ access_token, refresh_token });
    } else if (event === "SIGNED_OUT" || event === "USER_DELETED") {
      await supa.auth.signOut();
    }

    return NextResponse.json({ ok: true, event: event || null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
