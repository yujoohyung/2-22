// app/api/signals/check/route.js
import { createClient } from "@supabase/supabase-js";
// ⬇️ alias(@/...) 대신 상대경로 + .js 확장자
import { calcRSI } from "../../../../lib/rsi.js";
import { isCheckTimeKST } from "../../../../lib/market.js";
import { decideBuyLevel, computeBasketQuantities } from "../../../../lib/formulas.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) { return POST(req); }   // ← 추가
export async function POST(req) {
  try {
    // body의 symbol은 무시(설정의 main_symbol 사용)
    await req.json().catch(() => ({}));

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 1) 설정(한 줄) 읽기
    const { data: sets, error: se } = await supa
      .from("settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (se) throw se;
    if (!sets) {
      return new Response(
        JSON.stringify({ error: "settings not found" }),
        { status: 400 }
      );
    }

    const main = sets.main_symbol || "A";
    const buyLevels = sets.rsi_buy_levels || [43, 36, 30];
    const checkTimes = sets.rsi_check_times || ["10:30", "14:30"];
    const basket = sets.basket || [];

    // 2) 체크 시각 필터(한국시간 10:30 / 14:30)
    if (!isCheckTimeKST(checkTimes, 2)) {
      return new Response(JSON.stringify({ skip: "not-check-time" }), {
        status: 200,
      });
    }

    // 3) 메인 심볼 최근 종가 200개 → RSI 계산
    const { data: aPrices, error: pe } = await supa
      .from("prices")
      .select("ts, close")
      .eq("symbol", main)
      .order("ts", { ascending: false })
      .limit(200);
    if (pe) throw pe;

    const arr = (aPrices || []).sort(
      (x, y) => new Date(x.ts) - new Date(y.ts)
    );
    const closes = arr.map((x) => Number(x.close));
    const rsi = calcRSI(closes, sets.rsi_period || 14);
    if (rsi == null) {
      return new Response(
        JSON.stringify({ error: "not-enough-data" }),
        { status: 400 }
      );
    }

    // 4) 단계 판정
    const level = decideBuyLevel(rsi, buyLevels);
    if (level < 0) {
      // 매수 단계 아님 → 기록 없이 종료
      return new Response(JSON.stringify({ rsi, level: -1, created: [] }), {
        status: 200,
      });
    }

    // 5) 바스켓 현재가 맵
    const priceMap = {};
    for (const { symbol } of basket) {
      const { data: p } = await supa
        .from("prices")
        .select("close")
        .eq("symbol", symbol)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      priceMap[symbol] = Number(p?.close || 0);
    }

    // 6) 단계별 예산 → 수량 산출 → alerts insert
    const plans = computeBasketQuantities(sets, level, priceMap);

    const created = [];
    for (const plan of plans) {
      const msg =
        `RSI ${rsi.toFixed(2)} (<= ${buyLevels[level]}) → ${level + 1}단계\n` +
        `${plan.symbol} 약 ${plan.qty}주 (예산 ${plan.krw.toLocaleString()}원, 반올림)`;

      const { data: ins, error: ie } = await supa
        .from("alerts")
        .insert({
          symbol: plan.symbol,
          rsi,
          level: `${level + 1}단계`,
          message: msg,
        })
        .select()
        .single();

      if (!ie && ins) created.push(ins);
    }

    return new Response(JSON.stringify({ rsi, level, created }), {
      status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), {
      status: 500,
    });
  }
}
