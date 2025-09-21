// /app/api/admin-create-user/route.js
import "server-only";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/auth-server";

export async function POST(req) {
  try {
    const { email, password, code } = await req.json();
    const ADMIN_CREATE_CODE = process.env.ADMIN_CREATE_CODE || "";
    if (!ADMIN_CREATE_CODE || code !== ADMIN_CREATE_CODE) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const supa = getServiceClient(); // ✅ 서버 전용 클라
    const { data, error } = await supa.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, user: data?.user ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
