// app/api/signals/check/route.js
import { createClient } from "@supabase/supabase-js";
import { calcRSI } from "../../../../lib/rsi.js";
import { isCheckTimeKST } from "../../../../lib/market.js";
import { decideBuyLevel, computeBasketQuantities } from "../../../../lib/formulas.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function kstDate(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth()+1)}-${p(k.getUTCDate())}`;
}

export async function GET(req) { return POST(req); }
export async function POST(req) {
  try {
    await req.json().catch(() => ({})); // body 무시
    const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    // settings
    const { data: sets } = await supa.from("settings").select("*").limit(1).maybeSingle();
    if (!sets) return new Response(JSON.stringify({ error: "settings not found" }), { status: 400 });

    const main = sets.main_symbol || "A";
    const buyLevels = sets.rsi_buy_levels || [43,36,30];
    const checkTimes = sets.rsi_check_times || ["10:30", "14:30"];
    const basket = sets.basket || []; // [{symbol, weight}, ...]

    if (!isCheckTimeKST(checkTimes, 2)) {
      return new Response(JSON.stringify({ skip: "not-check-time" }), { status: 200 });
    }

    // main 가격 → RSI
    const { data: aPrices, error: pe } = await supa
      .from("prices").select("ts, close").eq("symbol", main)
      .order("ts", { ascending: false }).limit(200);
    if (pe) throw pe;

    const arr = (aPrices || []).sort((x,y)=> new Date(x.ts) - new Date(y.ts));
    const closes = arr.map(x => Number(x.close));
    const rsi = calcRSI(closes, sets.rsi_period || 14);
    if (rsi == null) return new Response(JSON.stringify({ error: "not-enough-data" }), { status: 400 });

    const level = decideBuyLevel(rsi, buyLevels); // -1 이면 매수 아님
    const action = level < 0 ? "NONE" : "BUY";

    // 현재가 맵
    const priceMap = {};
    for (const { symbol } of basket) {
      const { data: p } = await supa
        .from("prices").select("close").eq("symbol", symbol)
        .order("ts", { ascending: false }).limit(1).maybeSingle();
      priceMap[symbol] = Number(p?.close || 0);
    }

    // 계획 수량
    const plans = level < 0 ? [] : computeBasketQuantities(sets, level, priceMap);
    const yBudget = Number(sets.yearly_budget || 0);

    // 매도 권장 수량 계산(보유량 정보가 있을 때만 숫자로)
    const sellRatio = Number(sets.sell_ratio ?? 0.3);
    const holdings = sets.holdings_json || null; // { [symbol]: qty }
    const sellSuggest = {};
    if (holdings && typeof holdings === "object") {
      for (const { symbol } of basket) {
        const have = Number(holdings[symbol] || 0);
        sellSuggest[symbol] = have > 0 ? Math.max(1, Math.floor(have * sellRatio)) : 0;
      }
    }

    // alerts insert (심볼 별 1건씩)
    const created = [];
    const baseDate = kstDate();

    for (const plan of (plans.length ? plans : basket)) {
      const sym = plan.symbol || plan?.symbol;
      const qtyBuy = plan.qty || 0;

      // 메시지 구성(요구 포맷)
      const msgLines = [
        `날짜: ${baseDate}`,
        `연간 납입금액: ${yBudget ? yBudget.toLocaleString() + "원" : "-"}`,
        `RSI 단계: ${level >= 0 ? `${level + 1}단계 (${rsi.toFixed(2)})` : "해당없음"}`,
        `나스닥/빅테크: 심볼=${sym}`,
        `${action === "BUY" ? "매수" : "대기"} 수량: ${qtyBuy ? `${qtyBuy}주` : "-"}`,
      ];

      // 매도 권장
      if (sellSuggest[sym] > 0) {
        msgLines.push(`매도 권장: 보유 ${sellSuggest[sym]}주 (기준 ${Math.round(sellRatio*100)}%)`);
      } else {
        msgLines.push(`매도 권장: 보유수량의 ${Math.round(sellRatio*100)}% (최소 1주)`);
      }

      const msg = msgLines.join("\n");

      const { data: ins, error: ie } = await supa
        .from("alerts")
        .insert({
          symbol: sym,
          rsi,
          level: level >= 0 ? `${level + 1}단계` : "해당없음",
          message: msg,
          sent: false,
        })
        .select().single();

      if (!ie && ins) created.push(ins);
    }

    return new Response(JSON.stringify({ ok: true, rsi, level, created }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500 });
  }
}
