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
/* -------------------------------- */

/* ---------- 유틸 ---------- */
const DEF_STAGE_AMOUNTS = [120000, 240000, 552000]; // 기본 단계 예산
const enc = new TextEncoder();

function fmtKRW(n) {
  const v = Number(n || 0);
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}
function fmtPct(n, digits = 2) {
  if (!Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(digits)}%`;
}
function fmtKST(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 60 * 60 * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
function parseStage(levelText) {
  // "1단계" / "2단계" / "3단계" → 1,2,3
  if (!levelText) return null;
  const m = String(levelText).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** alerts(unsent)에서 현재 스테이지/RSI 한 번만 추출 */
function summarizeAlerts(alerts = []) {
  if (!alerts.length) return null;
  // 스테이지는 가장 높은 단계(3>2>1) 우선
  let stage = null;
  let rsi = null;
  for (const a of alerts) {
    const s = parseStage(a.level);
    if (s != null) stage = stage == null ? s : Math.max(stage, s);
    if (Number.isFinite(a.rsi)) {
      rsi = rsi == null ? Number(a.rsi) : Math.min(rsi, Number(a.rsi));
    }
  }
  return { stage, rsi };
}

/** 최신 가격 맵 {symbol: price} */
async function loadLatestPrices(supa, symbols) {
  const out = {};
  for (const symbol of symbols) {
    // prices: (symbol, ts, close)
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

/** user_trades에서 잔여 수량 {userId: {symbol: remQty}} */
async function loadRemaindersByUser(supa, userIds) {
  if (!userIds.length) return {};
  const { data: trades, error } = await supa
    .from("user_trades")
    .select("user_id, symbol, qty, side")
    .in("user_id", userIds);
  if (error) throw error;

  const rem = {};
  for (const t of (trades || [])) {
    const uid = t.user_id;
    const sym = t.symbol;
    const q = Number(t.qty || 0);
    if (!rem[uid]) rem[uid] = {};
    if (!rem[uid][sym]) rem[uid][sym] = 0;
    if (t.side === "BUY") rem[uid][sym] += q;
    else if (t.side === "SELL") rem[uid][sym] -= q;
  }
  // 음수 방지
  for (const uid of Object.keys(rem)) {
    for (const sym of Object.keys(rem[uid])) {
      rem[uid][sym] = Math.max(0, rem[uid][sym]);
    }
  }
  return rem;
}

/** 개인별 매수/매도 제안 생성 */
function planForUser({ user, stage, prices, remainders }) {
  // 입력 보정
  const basket = Array.isArray(user.basket) ? user.basket : [];
  const stageAmts = Array.isArray(user.stage_amounts_krw) && user.stage_amounts_krw.length
    ? user.stage_amounts_krw
    : DEF_STAGE_AMOUNTS;

  const stageIdx = Math.max(0, Math.min((stage || 1) - 1, stageAmts.length - 1));
  const stageBudget = Number(stageAmts[stageIdx] || 0);

  const buys = [];
  for (const { symbol, weight } of basket) {
    const w = Number(weight || 0);
    const price = Number(prices[symbol] || 0);
    const krw = Math.max(0, Math.round(stageBudget * w));
    const qty = price > 0 ? Math.max(1, Math.round(krw / price)) : 0; // 최소 1주(예산/가격>0)
    buys.push({ symbol, price, krw, qty });
  }

  // 30% 매도 제안 (잔여 기준)
  const rem = remainders[user.user_id] || {};
  const sells = Object.keys(rem).map((symbol) => {
    const rq = Number(rem[symbol] || 0);
    const qty = rq > 0 ? Math.max(1, Math.floor(rq * 0.3)) : 0;
    return { symbol, remQty: rq, qty };
  }).filter(x => x.qty > 0);

  return { buys, sells, stageBudget };
}

/* ---------- 라우트 ---------- */
export async function POST(req) {
  try {
    // 🔐 헤더 검사
    assertCronAuth(req);

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 1) 아직 안 보낸 alerts (전역) 불러오기
    const { data: alerts, error: ae } = await supa
      .from("alerts")
      .select("*")
      .eq("sent", false)
      .order("created_at", { ascending: true });
    if (ae) throw ae;

    if (!alerts?.length) {
      return new Response(JSON.stringify({ ok: true, msg: "no alerts" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const sum = summarizeAlerts(alerts);
    const stage = sum?.stage ?? 1;
    const rsiVal = sum?.rsi ?? null;

    // 2) 개인 설정(user_settings) 전부
    const { data: userRows, error: ue } = await supa
      .from("user_settings")
      .select("*");
    if (ue) throw ue;

    if (!userRows?.length) {
      // 사용자 없으면 브로드캐스트 채널로라도 간단히 알림
      const chatId = process.env.TELEGRAM_CHAT_ID_BROADCAST || null;
      if (chatId) {
        const text = [
          `[신호] ${fmtKST()} (KST)`,
          rsiVal != null ? `RSI ${rsiVal.toFixed(2)} → ${stage}단계` : `${stage}단계`,
          `개인 설정이 없어 방송 알림만 전송되었습니다.`,
        ].join("\n");
        await sendTelegram(text, chatId);
      }
      // 그래도 sent 마킹
      const ids = alerts.map(a => a.id);
      await supa.from("alerts").update({ sent: true }).in("id", ids);
      return new Response(JSON.stringify({ ok: true, sentUsers: 0, alerts: ids.length }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // 3) 가격 조회용 모든 심볼 수집(모든 유저 바스켓)
    const symbols = new Set();
    for (const u of userRows) {
      (Array.isArray(u.basket) ? u.basket : []).forEach(b => b?.symbol && symbols.add(b.symbol));
    }
    // alerts 안의 심볼도 포함(안전)
    alerts.forEach(a => a?.symbol && symbols.add(a.symbol));
    const priceMap = await loadLatestPrices(supa, Array.from(symbols));

    // 4) 잔여 수량(매도 30%) 계산 기반
    const userIds = userRows.map(u => u.user_id).filter(Boolean);
    const remainders = await loadRemaindersByUser(supa, userIds);

    // 5) 사용자별 텔레그램 전송
    let sentUsers = 0;
    const kstNow = fmtKST();
    for (const u of userRows) {
      const chatId = u.telegram_chat_id || process.env.TELEGRAM_CHAT_ID_BROADCAST;
      if (!chatId) continue; // 보낼 곳 없으면 skip

      const { buys, sells, stageBudget } = planForUser({
        user: u,
        stage,
        prices: priceMap,
        remainders,
      });

      const buyLine = buys.length
        ? buys.map(b => `${b.symbol} 약 ${b.qty}주`).join(", ")
        : "바스켓 미설정";

      const sellLine = sells.length
        ? sells.map(s => `${s.symbol} ${s.qty}주`).join(", ")
        : "제안 없음";

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

    // 6) 전역 alerts 마킹(sent=true)
    const ids = alerts.map(a => a.id);
    const { error: me } = await supa
      .from("alerts")
      .update({ sent: true })
      .in("id", ids);
    if (me) throw me;

    return new Response(
      JSON.stringify({ ok: true, stage, rsi: rsiVal, sentUsers, alerts: ids.length }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  } catch (e) {
    return jsonError(e);
  }
}
