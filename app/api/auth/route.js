// /app/api/auth/route.js
import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth-server.js"; // 서버 전용 유틸 (상대경로)

export async function GET(req) {
  try {
    const { user } = await requireUser(req); // Bearer 또는 쿠키 세션
    return NextResponse.json({ ok: true, user });
  } catch {
    return NextResponse.json({ ok: false, user: null }, { status: 401 });
  }
}
