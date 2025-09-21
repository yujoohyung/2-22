// /app/api/alerts/list/route.js
import "server-only";
import { NextResponse } from "next/server";
import { getServiceClient } from "../../../../lib/auth-server.js"; // 상대경로!

export async function GET(req) {
  try {
    const supa = getServiceClient(); // 서버 전용 (Service Role)

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || 50), 1), 200);

    const { data, error } = await supa
      .from("alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
