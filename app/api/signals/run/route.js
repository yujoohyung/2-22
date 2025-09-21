// app/api/signals/check/route.js
import { supa } from "@/lib/supaClient";
import { calcRSI } from "../../../../lib/rsi.js";
import { isCheckTimeKST } from "../../../../lib/market.js";
import { decideBuyLevel, computeBasketQuantities } from "../../../../lib/formulas.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- 보안 가드 ---------- */
function assertCronAuth(req) {
  const env = (process.env.CRON_SECRET || "").trim();
  const hdr = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!env || hdr !== env) throw new Error("unauthorized");
}
function jsonError(e) {
  const msg = e?.message || "error";
  const status = msg === "unauthorized" ? 401 : 500;
  return Response.json({ ok: false, error: msg, __ver: "check-2025-09-13-a" }, { status });
}
/* -------------------------------- */

function kstDate(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth()+1)}-${p(k.getUTCDate())}`;
}

export async function GET(req) { return POST(req); }

export async function POST(req) {
  try {
    // 🔐 시크릿 검사
    assertCronAuth(req);

    // ✅ 강제 실행 플래그 (?force=1)
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";

    // body는 사용하지 않음 (파서 에러 방지)
    await req.json().catch(() => ({}));

    const supa = getServiceClient();

    // settings
    const { data: sets } = await supa.from("settings").select("*").limit(1).maybeSingle();
    if (!sets) return Response.json({ ok: false, error: "settings not found", __ver: "check-2025-09-13-a" }, { status: 400 });

    const main = sets.main_symbol || "A";
    const buyLevels = sets.rsi_buy_levels || [43, 36, 30];
    const checkTimes = sets.rsi_check_times || ["10:30", "14:30"];
    const basket = sets.basket || []; // [{symbol, weight}, ...]

    // ⬇️ 점검 시간 우회 (force가 아니면 시간 체크)
    if (!force && !isCheckTimeKST(checkTimes, 2)) {
      // 디버그용 현재 KST 시각도 함께 반환 (필요시 제거 가능)
      const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const p = (n) => String(n).padStart(2, "0");
      const nowKST = `${now.getUTCFullYear()}-${p(now.getUTCMonth()+1)}-${p(now.getUTCDate())} ${p(now.getUTCHours())}:${p(now.getUTCMinutes())}`;
      return Response.json({ skip: "not-check-time", force, debug: { checkTimes, nowKST }, __ver: "check-2025-09-13-a" });
    }

    // main 가격 → RSI
    const { data: aPrices, error: pe } = await supa
      .from("prices").select("ts, close").eq("symbol", main)
      .order("ts", { ascending: false }).limit(200);
    if (pe) throw pe;

    const arr = (aPrices || []).sort((x, y) => new Date(x.ts) - new Date(y.ts));
    const closes = arr.map(x => Number(x.close));
    const rsi = calcRSI(closes, sets.rsi_period || 14);
    if (rsi == null) return Response.json({ ok: false, error: "not-enough-data", __ver: "check-2025-09-13-a" }, { status: 400 });

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

      const msgLines = [
        `날짜: ${baseDate}`,
        `연간 납입금액: ${yBudget ? yBudget.toLocaleString() + "원" : "-"}`,
        `RSI 단계: ${level >= 0 ? `${level + 1}단계 (${rsi.toFixed(2)})` : "해당없음"}`,
        `나스닥/빅테크: 심볼=${sym}`,
        `${action === "BUY" ? "매수" : "대기"} 수량: ${qtyBuy ? `${qtyBuy}주` : "-"}`,
      ];

      if (sellSuggest[sym] > 0) {
        msgLines.push(`매도 권장: 보유 ${sellSuggest[sym]}주 (기준 ${Math.round(sellRatio*100)}%)`);
      } else {
        msgLines.push(`매도 권장: 보유수량의 ${Math.round(sellRatio*100)}% (최소 1주)`);
      }

      const { data: ins, error: ie } = await supa
        .from("alerts")
        .insert({
          symbol: sym,
          rsi,
          level: level >= 0 ? `${level + 1}단계` : "해당없음",
          message: msgLines.join("\n"),
          sent: false,
        })
        .select().single();

      if (!ie && ins) created.push(ins);
    }

    return Response.json({ ok: true, rsi, level, created, __ver: "check-2025-09-13-a" });
  } catch (e) {
    return jsonError(e);
  }
}
