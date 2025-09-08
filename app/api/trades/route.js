// app/api/trades/route.js
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { symbol, date, price, qty, side } = await req.json().catch(() => ({}));

    // 기본 검증
    if (!symbol || !date || !Number(price) || !Number(qty) || !["BUY","SELL"].includes(side)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid payload" }), { status: 400 });
    }

    // 사용자 세션 기반 Supabase 클라이언트 (서비스 롤 X, RLS 사용)
    const supa = createRouteHandlerClient({ cookies });
    const { data: userResp, error: uerr } = await supa.auth.getUser();
    if (uerr || !userResp?.user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    }
    const user = userResp.user;

    // user_trades RLS 정책: auth.uid() = user_id → 본인 레코드만 허용
    const { error: ierr, data: inserted } = await supa
      .from("user_trades")
      .insert({
        user_id: user.id,    // 테이블에 default auth.uid()가 없으니 명시
        symbol,
        date,                // 'YYYY-MM-DD' 문자열이면 Postgres date로 들어갑니다
        price: Number(price),
        qty: Number(qty),
        side,
      })
      .select()
      .single();

    if (ierr) {
      return new Response(JSON.stringify({ ok: false, error: ierr.message }), { status: 400 });
    }

    return new Response(JSON.stringify({ ok: true, trade: inserted }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500 });
  }
}
