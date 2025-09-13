// app/api/signals/check/route.js
import { createClient } from "@supabase/supabase-js";
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
  return Response.json({ ok: false, error: msg }, { status });
}
/* -------------------------------- */

function kstDate(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth()+1)}-${p(k.getUTCDate())}`;
}

/** 배이스 URL (서버 내에서 /api/kis 호출용) */
function getBase(req) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.CRON_BASE_URL) return process.env.CRON_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

/** KIS 일봉에서 종가 배열 가져오기 (대시보드 CODE와 동일) */
async function fetchKISCloses({ req, code, days = 220 }) {
  try {
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const end = new Date();
    const start = new Date(); start.setDate(end.getDate() - (days + 20)); // 여유 버퍼
    const base = getBase(req);
    const url = new URL(`/api/kis/daily?code=${code}&start=${ymd(start)}&end=${ymd(end)}`, base);
    const r = await fetch(url.toString(), { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const out = j?.output || j?.output1 || [];
    const rows = Array.isArray(out) ? out : [];
    const closes = rows
      .map(x => Number(x.stck_clpr || x.tdd_clsprc || x.close))
      .filter(v => Number.isFinite(v));
    return closes.length ? closes : null;
  } catch {
    return null;
  }
}

export async function GET(req) { return POST(req); }

export async function POST(req) {
  try {
    // 🔐 헤더 검사
    assertCronAuth(req);

    // ✅ 강제 실행 플래그 (?force=1 이면 시간 체크 우회)
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";

    // body는 사용하지 않음 (파서 에러 방지용)
    await req.json().catch(() => ({}));

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // settings
    const { data: sets } = await supa.from("settings").select("*").limit(1).maybeSingle();
    if (!sets) return Response.json({ ok: false, error: "settings not found" }, { status: 400 });

    // 메인 심볼/기간/체크시간/바스켓
    const main = sets.main_symbol || "A";
    const buyLevels = sets.rsi_buy_levels || [43, 36, 30];
    const checkTimes = sets.rsi_check_times || ["10:30", "14:30"];
    const basket = sets.basket || []; // [{symbol, weight}, ...]
    const rsiPeriod = Number(sets.rsi_period || 14);

    // ⬇️ 점검 시간 우회 (force가 아니면 시간 체크)
    if (!force && !isCheckTimeKST(checkTimes, 2)) {
      return Response.json({ skip: "not-check-time" }, { status: 200 });
    }

    /* ---------- 1) DB prices 기반 RSI 계산 시도 ---------- */
    const { data: aPrices, error: pe } = await supa
      .from("prices").select("ts, close").eq("symbol", main)
      .order("ts", { ascending: false }).limit(300);
    if (pe) throw pe;

    const dbSorted = (aPrices || []).sort((x, y) => new Date(x.ts) - new Date(y.ts));
    let closes = dbSorted.map(x => Number(x.close)).filter(Number.isFinite);
    let rsi = calcRSI(closes, rsiPeriod);

    /* ---------- 2) 폴백: DB가 부족하면 KIS 일봉으로 RSI ---------- */
    const need = rsiPeriod + 1;
    const dbEnough = (closes?.length || 0) >= need && rsi != null;
    if (!dbEnough) {
      // settings에 있으면 사용, 없으면 대시보드 CODE(418660)
      const kisCode = sets.kis_main_code || "418660";
      const kisCloses = await fetchKISCloses({ req, code: kisCode, days: Math.max(220, need + 10) });
      if (kisCloses && kisCloses.length >= need) {
        closes = kisCloses;
        rsi = calcRSI(kisCloses, rsiPeriod);
      }
    }

    if (rsi == null) {
      return Response.json({ ok: false, error: "not-enough-data" }, { status: 400 });
    }

    const level = decideBuyLevel(rsi, buyLevels); // -1 이면 매수 아님
    const action = level < 0 ? "NONE" : "BUY";

    // 현재가 맵 (바스켓 심볼별 최신 1건)
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

    return Response.json({ ok: true, rsi, level, created }, { status: 200 });
  } catch (e) {
    return jsonError(e);
  }
}
