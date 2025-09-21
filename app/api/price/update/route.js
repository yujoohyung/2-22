// (너가 편집 중인 그 파일 경로에 그대로 붙여넣기)
// 예: app/api/prices/insert/route.js  또는 app/api/price/route.js
import "server-only";
import { getServiceClient } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    let { symbol, ts, close } = body || {};

    // --- 입력값 검증/정규화 ---
    if (typeof symbol !== "string" || !symbol.trim()) {
      return new Response(
        JSON.stringify({ ok: false, error: "symbol required" }),
        { status: 400, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
    symbol = symbol.trim().toUpperCase();

    const when = ts ? new Date(ts) : new Date();
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid ts (timestamp)" }),
        { status: 400, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    const price = Number(close);
    if (!Number.isFinite(price)) {
      return new Response(
        JSON.stringify({ ok: false, error: "close must be a number" }),
        { status: 400, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    // --- 서버 전용(Service Role) 클라이언트 ---
    const admin = getServiceClient();

    // prices: primary key (symbol, ts)
    // 중복 타임스탬프 요청 대비 upsert 사용
    const { error } = await admin
      .from("prices")
      .upsert(
        { symbol, ts: when.toISOString(), close: price },
        { onConflict: "symbol,ts" }
      );

    if (error) throw error;

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
