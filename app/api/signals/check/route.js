import { createClient } from "@supabase/supabase-js";
import { calcRSI } from "@/lib/rsi";
import { isCheckTimeKST } from "@/lib/market";
import { decideBuyLevel, computeBasketQuantities } from "@/lib/formulas";

export async function POST(req) {
  try {
    const { symbol: ignoreSymbol } = await req.json(); // 무시(설정의 main_symbol 사용)
    const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    // 1) 설정(1행) 읽기
    const { data: sets } = await supa.from("settings").select("*").limit(1).maybeSingle();
    if (!sets) return new Response(JSON.stringify({ error: "settings not found" }), { status: 400 });

    const main = sets.main_symbol || "A";
    const buyLevels = sets.rsi_buy_levels || [43,36,30];
    const checkTimes = sets.rsi_check_times || ["10:30","14:30"];
    const basket = sets.basket || [];

    // 2) 체크 시각 필터: 10:30 / 14:30만
    if (!isCheckTimeKST(checkTimes, 2)) {
      return new Response(JSON.stringify({ skip: "not-check-time" }), { status: 200 });
    }

    // 3) 메인(A) 최근 가격 → RSI
    const { data: aPrices, error: pe } = await supa.from("prices")
      .select("ts, close").eq("symbol", main).order("ts", { ascending: false }).limit(200);
    if (pe) throw pe;
    const arr = (aPrices || []).sort((x,y)=> new Date(x.ts)-new Date(y.ts));
    const closes = arr.map(x=> Number(x.close));
    const rsi = calcRSI(closes, sets.rsi_period || 14);
    if (rsi == null) return new Response(JSON.stringify({ error: "not-enough-data" }), { status: 400 });

    // 4) 단계 판정
    const level = decideBuyLevel(rsi, buyLevels);
    if (level < 0) {
      return new Response(JSON.stringify({ rsi, level: -1, created: [] }), { status: 200 });
    }

    // 5) 바스켓 현재가 맵 만들기
    const priceMap = {};
    for (const { symbol } of basket) {
      const { data: p } = await supa.from("prices").select("close").eq("symbol", symbol)
        .order("ts", { ascending: false }).limit(1).maybeSingle();
      priceMap[symbol] = Number(p?.close || 0);
    }

    // 6) 수량 계산(반올림) → 알림 insert (심볼별 한 건씩)
    const plans = computeBasketQuantities(sets, level, priceMap);
    const created = [];
    for (const plan of plans) {
      const msg = `RSI ${rsi.toFixed(2)} (<= ${buyLevels[level]}) → ${level+1}단계: ${plan.symbol} 약 ${plan.qty}주 (예산 ${plan.krw.toLocaleString()}원, 반올림)`;
      const { data: ins, error: ie } = await supa
        .from("alerts").insert({ symbol: plan.symbol, rsi, level: `${level+1}단계`, message: msg }).select().single();
      if (!ie && ins) created.push(ins);
    }

    return new Response(JSON.stringify({ rsi, level, created }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
