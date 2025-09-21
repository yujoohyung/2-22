// /app/api/price/last/route.js
import "server-only";
import { NextResponse } from "next/server";
import { getServiceClient } from "../../../../lib/auth-server.js"; // 서버 전용 클라 (상대경로)

export async function GET(req) {
  try {
    const supa = getServiceClient();

    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").toUpperCase();

    if (!symbol) {
      return NextResponse.json(
        { ok: false, error: "symbol is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supa
      .from("prices")
      .select("symbol, ts, close")
      .eq("symbol", symbol)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "no data" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
