// /app/api/user-settings/save/route.js
import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/auth-server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { yearly_budget } = await req.json().catch(() => ({}));
    if (yearly_budget == null) {
      return NextResponse.json({ ok: false, error: "yearly_budget is required" }, { status: 400 });
    }

    // 1) 유저 인증 (Bearer 우선, 없으면 쿠키)
    const { supa, user, token } = await requireUser(req);

    // 2) 내 줄 업서트 (RLS: jwt_uid() = user_id 정책 충족)
    const up = await supa
      .from("user_settings")
      .upsert(
        {
          user_id: user.id,
          yearly_budget: Number(yearly_budget || 0),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (up.error) throw up.error;

    return NextResponse.json({
      ok: true,
      via: token ? "header" : "cookie",
      received: { yearly_budget: Number(yearly_budget || 0) },
      row: up.data || null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: /unauthorized/i.test(String(e?.message || e)) ? 401 : 500 }
    );
  }
}
