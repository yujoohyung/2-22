import { createClient } from "@supabase/supabase-js";
import { calcRSI } from "@/lib/rsi";                   // 이미 있는 파일
import { isCheckTimeKST } from "@/lib/market";         // 이미 있는 파일
import { decideBuyLevel, computeBasketQuantities } from "@/lib/formulas"; // 이미 있는 파일

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler() {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 1) 설정 1행
    const { data: sets, error: se } = await supa
      .from("settings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (se) throw se;
    if (!sets) return new Response(JSON.stringify({ error: "settings not found" }), { status: 400 });

    const buyLevels = sets.rsi_buy_levels || [43, 36, 30];
    const checkTimes = sets.rsi_check_times || ["10:30", "14:30"];
    const basket = sets.basket || [];
    const main = sets.main_symbol || (basket[0]?.symbol ?? "A");

    // 2) 시간 가드 (KST 10:30, 14:30)
    if (!isCheckTimeKST(checkTimes, 2)) {
      return new Response(JSON.stringify({ skip: "not-check-time" }), { status: 200 });
    }

    // 3) 메인 심볼 가격 200개 → RSI
    const { data: aPrices, error: pe } = await supa
      .from("prices")
      .select("ts, close")
      .eq("symbol", main)
      .order("ts", { ascending: false })
      .limit(200);
    if (pe) throw pe;

    const arr = (aPrices || []).sort((x, y) => new Date(x.ts) - new Date(y.ts));
    const closes = arr.map((x) => Number(x.close));
    const rsi = calcRSI(closes, sets.rsi_period || 14);
    if (rsi == null) return new Response(JSON.stringify({ error: "not-enough-data" }), { status: 200 });

    // 4) 단계 판정
    const level = decideBuyLevel(rsi, buyLevels);
    if (level < 0) {
      return new Response(JSON.stringify({ rsi, level: -1, created: [] }), { status: 200 });
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

    // 6) 수량 계산 → alerts에 저장(심볼별 1행씩)
    const plans = computeBasketQuantities(sets, level, priceMap);
    const created = [];
    for (const plan of plans) {
      const msg = `RSI ${rsi.toFixed(2)} (<= ${buyLevels[level]}) → ${level + 1}단계: ${plan.symbol} 약 ${plan.qty}주 (예산 ${plan.krw.toLocaleString()}원)`;
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

    return new Response(JSON.stringify({ rsi, level, created }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}

// ✅ Vercel Cron 호환 (GET/POST 둘 다)
export const GET = handler;
export const POST = handler;
