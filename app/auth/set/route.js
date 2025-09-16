// app/auth/set/route.js
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { access_token, refresh_token } = await req.json();
    const supa = createRouteHandlerClient({ cookies });

    // 토큰 둘 다 없으면 서버 쿠키 정리(로그아웃)
    if (!access_token && !refresh_token) {
      await supa.auth.signOut();
      return Response.json({ ok: true, cleared: true });
    }

    const { data, error } = await supa.auth.setSession({
      access_token,
      refresh_token,
    });
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 401 });
    }
    return Response.json({ ok: true, user_id: data.user?.id ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
