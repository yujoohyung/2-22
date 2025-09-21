// app/api/allowed-email/route.js
import "server-only";
import { getServiceClient } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { email } = await req.json().catch(() => ({}));

    if (!email) {
      return new Response(
        JSON.stringify({ ok: false, allowed: false, error: "missing email" }),
        { status: 400, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    // Service Role 클라이언트 (서버에서만 사용)
    const admin = getServiceClient();

    // allowed_emails.email 은 citext라 eq도 대소문자 무시됨
    const { data, error } = await admin
      .from("allowed_emails")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (error) throw error;

    return new Response(
      JSON.stringify({ ok: true, allowed: !!data }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, allowed: false, error: String(e?.message || e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
