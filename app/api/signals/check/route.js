// app/api/signals/check/route.js
import { createClient } from "@supabase/supabase-js";
// ⬇️ alias 대신 상대경로(.js 확장자 포함)
import { calcRSI } from "../../../../lib/rsi.js";
import { isCheckTimeKST } from "../../../../lib/market.js";
import { decideBuyLevel, computeBasketQuantities } from "../../../../lib/formulas.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** (선택) Vercel Cron 보안: 환경변수 CRON_SECRET가 설정되어 있으면 GET에서만 검사 */
function guardCronGET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}` ? null : new Response("Unauthorized", { status: 401 });
}

/** Vercel 크론은 GET만 호출 → POST 로직을 재사용 */
export async function GET(req) {
  const g = guardCronGET(req);
  if (g) return g;
  return POST(req);
}

export async function POST(req) {
  try {
    // body는 없어도 됨(에러 무시)
    await req.json().catch(() => ({}));

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 1) 설정 1행
    const { data: sets, error: se } = await supa
      .from("settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (se) throw se;
    if (!sets) {
      return new Response(JSON.stringify({ error: "settings not found" }), { status: 400 });
    }

    const main       = sets.main_symbol || "A";
    const buyLevels  = Array.isArray(sets.rsi_buy_levels) ? sets.rsi_buy_levels : [43, 36, 30];
    const checkTimes = Array.isArray(sets.rsi_check_times) ? sets.rsi_check_times : ["10:30", "14:30"];
    const basket     = Array.isArray(sets.basket) ? sets.basket : [];

    // 2) 체크 시각 필터(한국시간 10:30/14:30) — 수동 테스트는 ?force=1 로 우회
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    if (!force && !isCheckTimeKST(checkTimes, 2)) {
      return new Response(JSON.stringify({ skip: "not-check-time" }), { status: 200 });
    }

    // 3) 메인 심볼 최근 종가 200개 → RSI
    const { data: aPrices, error: pe } = await supa
      .from("prices")
      .select("ts, close")
      .eq("symbol", main)
      .order("ts", { ascending: false })
      .limit(200);
    if (pe) throw pe;

    const arr    = (aPrices || []).sort((x, y) => new Date(x.ts) - new Date(y.ts));
    const closes = arr.map((x) => Number(x.close)).filter((v) => Number.isFinite(v));
    const rsi    = calcRSI(closes, sets.rsi_period || 14);

    if (!Number.isFinite(rsi)) {
      return new Response(JSON.stringify({ error: "not-enough-data" }), { status: 400 });
    }

    // 4) 단계 판정
    const level = decideBuyLevel(rsi, buyLevels);
    if (level < 0) {
      return new Response(JSON.stringify({ rsi, level: -1, created: [] }), { status: 200 });
    }

    // 5) 바스켓 현재가 맵
    const priceMap = {};
    for (const it of basket) {
      const sym = it?.symbol;
      if (!sym) continue;
      const { data: p } = await supa
        .from("prices")
        .select("close")
        .eq("symbol", sym)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      priceMap[sym] = Number(p?.close || 0);
    }

    // 6) 수량 산출 → alerts insert
    const plans = computeBasketQuantities(sets, level, priceMap);
    const created = [];

    for (const plan of plans) {
      const qty = Math.max(0, Math.round(Number(plan.qty || 0)));
      const krw = Math.max(0, Math.round(Number(plan.krw || 0)));
      const msg =
        `RSI ${Number(rsi).toFixed(2)} (<= ${buyLevels[level]}) → ${level + 1}단계\n` +
        `${plan.symbol} 약 ${qty}주 (예산 ${krw.toLocaleString()}원, 반올림)`;

      const { data: ins, error: ie } = await supa
        .from("alerts")
        .insert({
          symbol: plan.symbol,
          rsi: Number(rsi),
          level: `${level + 1}단계`,
          message: msg,
        })
        .select()
        .single();

      if (!ie && ins) created.push(ins);
    }

    return new Response(JSON.stringify({ rsi, level, created }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
}
