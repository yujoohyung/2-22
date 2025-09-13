// app/api/signals/dispatch/route.js
import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../../../../lib/telegram.js";

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
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/* ---------- 유틸 ---------- */
const DEF_STAGE_AMOUNTS = [120000, 240000, 552000]; // 하위호환
function fmtKRW(n) { const v = Number(n || 0); return `${Math.round(v).toLocaleString("ko-KR")}원`; }
function fmtKST(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 60 * 60 * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
function parseStage(t) { const m = String(t || "").match(/(\d+)/); return m ? Number(m[1]) : null; }
function normSymbol(sym) {
  const s = String(sym || "").toLowerCase();
  if (s === "dashboard" || s === "nasdaq2x" || s === "nasdaq" || s === "nasdaq100" || s === "nasdaq100 2x") return "nasdaq2x";
  if (s === "stock2"   || s === "bigtech2x" || s === "bigtech") return "bigtech2x";
  return sym;
}
function summarizeAlerts(alerts = []) {
  if (!alerts?.length) return null;
  let stage = null, rsi = null;
  for (const a of alerts) {
    const s = parseStage(a.level);
    if (s != null) stage = stage == null ? s : Math.max(stage, s);
    if (Number.isFinite(a.rsi)) rsi = rsi == null ? Number(a.rsi) : Math.min(rsi, Number(a.rsi));
  }
  return { stage, rsi };
}
async function loadLatestPrices(supa, symbols) {
  const out = {};
  for (const symbol of symbols) {
    const { data } = await supa
      .from("prices")
      .select("close, ts")
      .eq("symbol", symbol)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    out[symbol] = Number(data?.close || 0);
  }
  return out;
}
async function loadRemaindersByUser(supa, userIds) {
  if (!userIds.length) return {};
  const { data: trades, error } = await supa
    .from("user_trades")
    .select("user_id, symbol, qty, side")
    .in("user_id", userIds);
  if (error) throw error;

  const rem = {};
  for (const t of trades || []) {
    const uid = t.user_id, sym = normSymbol(t.symbol);
    const q = Number(t.qty || 0);
    rem[uid] = rem[uid] || {};
    rem[uid][sym] = rem[uid][sym] || 0;
    if (t.side === "BUY")  rem[uid][sym] += q;
    if (t.side === "SELL") rem[uid][sym] -= q;
  }
  for (const uid of Object.keys(rem)) for (const sym of Object.keys(rem[uid])) rem[uid][sym] = Math.max(0, rem[uid][sym]);
  return rem;
}

/* ===== 예치금 페이지 계산식 탑재 ===== */
function computeStageAmountsBySymbolFromDeposit({ deposit, basket }) {
  const dep = Number(deposit || 0);
  if (!(dep > 0)) return null;

  // (1) 가중치: basket 우선, 없으면 60/40
  let weights = {};
  if (Array.isArray(basket) && basket.length) {
    for (const b of basket) {
      const sym = normSymbol(b?.symbol);
      const w = Number(b?.weight || 0);
      if (!sym || !(w > 0)) continue;
      weights[sym] = (weights[sym] || 0) + w;
    }
    const sumW = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    for (const k of Object.keys(weights)) weights[k] = weights[k] / sumW;
  } else {
    weights = { nasdaq2x: 0.6, bigtech2x: 0.4 };
  }

  // (2) 월 예상
  const monthly = {};
  for (const [sym, w] of Object.entries(weights)) monthly[sym] = Math.round((dep * w) / 12);

  // (3) 단계비중 × factor
  const r = { s1: 0.14, s2: 0.26, s3: 0.60 };
  const factor = 0.92;
  const base = { s1: {}, s2: {}, s3: {} };
  for (const [sym, m] of Object.entries(monthly)) {
    base.s1[sym] = Math.round(m * r.s1 * factor);
    base.s2[sym] = Math.round(m * r.s2 * factor);
    base.s3[sym] = Math.round(m * r.s3 * factor);
  }

  // (4) 바이어스: 나스닥×1.6 / 빅테크×0.4
  const bias = (sym) => (normSymbol(sym) === "nasdaq2x" ? 1.6 : normSymbol(sym) === "bigtech2x" ? 0.4 : 1.0);
  const out = { s1: {}, s2: {}, s3: {} };
  for (const stage of ["s1", "s2", "s3"]) for (const [sym, amt] of Object.entries(base[stage])) out[stage][sym] = Math.round(amt * bias(sym));
  return out; // { s1: {sym:KRW}, s2: {...}, s3: {...} }
}

function planForUser({ user, stage, prices, remainders }) {
  const stageIdx = Math.max(0, Math.min((stage || 1) - 1, 2));
  const stageKey = stageIdx === 0 ? "s1" : stageIdx === 1 ? "s2" : "s3";

  // 1) 저장된 심볼별 단계금액이 있으면 그대로
  let perSymbolAmount = null;
  if (user.stage_amounts_by_symbol && typeof user.stage_amounts_by_symbol === "object") {
    const obj = user.stage_amounts_by_symbol;
    if (obj?.[stageKey] && typeof obj[stageKey] === "object") perSymbolAmount = obj[stageKey];
  }

  // 2) 없으면 런타임 계산(예치금 페이지 로직)
  if (!perSymbolAmount) {
    const computed = computeStageAmountsBySymbolFromDeposit({
      deposit: user.deposit,
      basket: Array.isArray(user.basket) ? user.basket : [
        { symbol: "nasdaq2x", weight: 0.6 },
        { symbol: "bigtech2x", weight: 0.4 },
      ],
    });
    perSymbolAmount = computed ? computed[stageKey] : null;
  }

  // 3) 그래도 없으면 하위호환: 총예산 × weight
  const basket = Array.isArray(user.basket) ? user.basket : [];
  const stageAmts = Array.isArray(user.stage_amounts_krw) && user.stage_amounts_krw.length
    ? user.stage_amounts_krw : DEF_STAGE_AMOUNTS;
  const stageBudget = Number(stageAmts[stageIdx] || 0);

  const buys = [];
  for (const { symbol, weight } of basket) {
    const sym = normSymbol(symbol);
    const price = Number(prices[sym] || 0);
    let krw;
    if (perSymbolAmount && Number.isFinite(Number(perSymbolAmount[sym]))) {
      krw = Math.max(0, Math.round(Number(perSymbolAmount[sym])));
    } else {
      krw = Math.max(0, Math.round(stageBudget * Number(weight || 0)));
    }
    const qty = price > 0 ? Math.max(1, Math.round(krw / price)) : 0; // 최소 1주
    buys.push({ symbol: sym, price, krw, qty });
  }

  // 매도 제안: 잔여 30%
  const rem = remainders[user.user_id] || {};
  const sells = Object.keys(rem).map((sym0) => {
    const sym = normSymbol(sym0);
    const rq = Number(rem[sym] || 0);
    const qty = rq > 0 ? Math.max(1, Math.floor(rq * 0.3)) : 0;
    return { symbol: sym, remQty: rq, qty };
  }).filter(x => x.qty > 0);

  return { buys, sells, stageBudget };
}

/* ---------- 라우트 ---------- */
export async function POST(req) {
  try {
    assertCronAuth(req);

    const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    // 1) 미발송 alerts
    const { data: alerts, error: ae } = await supa
      .from("alerts").select("*")
      .eq("sent", false)
      .order("created_at", { ascending: true });
    if (ae) throw ae;

    if (!alerts?.length) {
      return new Response(JSON.stringify({ ok: true, msg: "no alerts" }), {
        status: 200, headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const sum = summarizeAlerts(alerts);
    const stage = sum?.stage ?? 1;
    const rsiVal = sum?.rsi ?? null;

    // 2) 사용자 설정
    const { data: userRows, error: ue } = await supa.from("user_settings").select("*");
    if (ue) throw ue;

    if (!userRows?.length) {
      const chatId = process.env.TELEGRAM_CHAT_ID_BROADCAST || null;
      if (chatId) {
        const text = [
          `[신호] ${fmtKST()} (KST)`,
          rsiVal != null ? `RSI ${rsiVal.toFixed(2)} → ${stage}단계` : `${stage}단계`,
          `개인 설정이 없어 방송 알림만 전송되었습니다.`,
        ].join("\n");
        await sendTelegram(text, chatId);
      }
      const ids = alerts.map(a => a.id);
      await supa.from("alerts").update({ sent: true }).in("id", ids);
      return new Response(JSON.stringify({ ok: true, sentUsers: 0, alerts: ids.length }), {
        status: 200, headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // 3) 가격 맵
    const symbols = new Set();
    for (const u of userRows) (Array.isArray(u.basket) ? u.basket : []).forEach(b => b?.symbol && symbols.add(normSymbol(b.symbol)));
    alerts.forEach(a => a?.symbol && symbols.add(normSymbol(a.symbol)));
    const priceMap = await loadLatestPrices(supa, Array.from(symbols));

    // 4) 잔여 수량 맵
    const userIds = userRows.map(u => u.user_id).filter(Boolean);
    const remainders = await loadRemaindersByUser(supa, userIds);

    // 5) 전송
    let sentUsers = 0;
    const kstNow = fmtKST();
    for (const u of userRows) {
      const chatId = u.telegram_chat_id || process.env.TELEGRAM_CHAT_ID_BROADCAST;
      if (!chatId) continue;

      const { buys, sells, stageBudget } = planForUser({ user: u, stage, prices: priceMap, remainders });

      const buyLine = buys.length ? buys.map(b => `${b.symbol} 약 ${b.qty}주`).join(", ") : "바스켓 미설정";
      const sellLine = sells.length ? sells.map(s => `${s.symbol} ${s.qty}주`).join(", ") : "제안 없음";

      const lines = [
        `[${u.user_email || "사용자"}]`,
        `${kstNow} (KST)`,
        `연 납입금: ${fmtKRW(u.deposit || 0)}`,
        rsiVal != null ? `RSI ${rsiVal.toFixed(2)} → ${stage}단계` : `${stage}단계`,
        `—`,
        `매수(단계예산 ${fmtKRW(stageBudget)}): ${buyLine}`,
        `매도 제안(잔여 30%): ${sellLine}`,
      ];
      await sendTelegram(lines.join("\n"), chatId);
      sentUsers += 1;
    }

    // 6) sent=true
    const ids = alerts.map(a => a.id);
    const { error: me } = await supa.from("alerts").update({ sent: true }).in("id", ids);
    if (me) throw me;

    return new Response(JSON.stringify({ ok: true, stage, rsi: rsiVal, sentUsers, alerts: ids.length }), {
      status: 200, headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return jsonError(e);
  }
}
export async function GET(req) { return POST(req); }
