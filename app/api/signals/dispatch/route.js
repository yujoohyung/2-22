// app/api/signals/dispatch/route.js
import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../../../../lib/telegram.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEF_STAGE_AMOUNTS = [120000, 240000, 552000];

function fmtKRW(n) { const v = Number(n || 0); return `${Math.round(v).toLocaleString("ko-KR")}원`; }
function fmtKST(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 60 * 60 * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth()+1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
function parseStage(levelText) { const m = String(levelText||"").match(/(\d+)/); return m ? Number(m[1]) : null; }
function summarizeAlerts(alerts = []) {
  if (!alerts.length) return null;
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
      .from("prices").select("close, ts")
      .eq("symbol", symbol).order("ts", { ascending: false }).limit(1).maybeSingle();
    out[symbol] = Number(data?.close || 0);
  }
  return out;
}
async function loadRemaindersByUser(supa, userIds) {
  if (!userIds.length) return {};
  const { data: trades, error } = await supa
    .from("user_trades").select("user_id, symbol, qty, side").in("user_id", userIds);
  if (error) throw error;
  const rem = {};
  for (const t of trades || []) {
    const uid = t.user_id, sym = t.symbol, q = Number(t.qty || 0);
    if (!rem[uid]) rem[uid] = {}; if (!rem[uid][sym]) rem[uid][sym] = 0;
    if (t.side === "BUY") rem[uid][sym] += q;
    else if (t.side === "SELL") rem[uid][sym] -= q;
  }
  for (const uid of Object.keys(rem)) for (const sym of Object.keys(rem[uid])) rem[uid][sym] = Math.max(0, rem[uid][sym]);
  return rem;
}
function planForUser({ user, stage, prices, remainders }) {
  const basket = Array.isArray(user.basket) ? user.basket : [];
  const stageAmts = Array.isArray(user.stage_amounts_krw) && user.stage_amounts_krw.length
    ? user.stage_amounts_krw : DEF_STAGE_AMOUNTS;
  const stageIdx = Math.max(0, Math.min((stage || 1) - 1, stageAmts.length - 1));
  const stageBudget = Number(stageAmts[stageIdx] || 0);

  const buys = [];
  for (const { symbol, weight } of basket) {
    const w = Number(weight || 0);
    const price = Number(prices[symbol] || 0);
    const krw = Math.max(0, Math.round(stageBudget * w));
    const qty = price > 0 ? Math.max(1, Math.round(krw / price)) : 0;
    buys.push({ symbol, price, krw, qty });
  }

  const rem = remainders[user.user_id] || {};
  const sells = Object.keys(rem).map((symbol) => {
    const rq = Number(rem[symbol] || 0);
    const qty = rq > 0 ? Math.max(1, Math.floor(rq * 0.3)) : 0;
    return { symbol, remQty: rq, qty };
  }).filter(x => x.qty > 0);

  return { buys, sells, stageBudget };
}

export async function POST() {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 전송할 alerts
    const { data: alerts, error: ae } = await supa
      .from("alerts").select("*").eq("sent", false).order("created_at", { ascending: true });
    if (ae) throw ae;

    if (!alerts?.length) {
      return new Response(JSON.stringify({ ok: true, msg: "no alerts" }), {
        status: 200, headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const sum = summarizeAlerts(alerts);
    const stage = sum?.stage ?? 1;
    const rsiVal = sum?.rsi ?? null;

    // ✅ 허용된 사용자만 가져오기 (뷰 사용 or IN 필터)
    const { data: allowedUsers, error: ue } = await supa
      .from("v_user_settings_allowed")
      .select("user_id, user_email, nickname, telegram_chat_id, notify_enabled, yearly_budget, deposit, basket, stage_amounts_krw, stage_amounts_by_symbol");
    if (ue) throw ue;

    const userRows = (allowedUsers || []).filter(u => u?.notify_enabled !== false);
    if (!userRows.length) {
      // 허용된 사용자가 없으면 브로드캐스트 한 번만 전송(옵션)
      const chatId = process.env.TELEGRAM_CHAT_ID_BROADCAST || null;
      if (chatId) {
        const text = [
          `[알림] ${fmtKST()} (KST)`,
          rsiVal != null ? `RSI ${rsiVal.toFixed(2)} → ${stage}단계` : `${stage}단계`,
          `허용된 사용자가 없어 방송만 전송.`,
        ].join("\n");
        await sendTelegram(text, chatId);
      }
      const ids = alerts.map(a => a.id);
      await supa.from("alerts").update({ sent: true }).in("id", ids);
      return new Response(JSON.stringify({ ok: true, sentUsers: 0, alerts: ids.length }), {
        status: 200, headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // 가격/잔여
    const symbols = new Set();
    for (const u of userRows) (Array.isArray(u.basket) ? u.basket : []).forEach(b => b?.symbol && symbols.add(b.symbol));
    alerts.forEach(a => a?.symbol && symbols.add(a.symbol));
    const priceMap = await loadLatestPrices(supa, Array.from(symbols));
    const userIds = userRows.map(u => u.user_id).filter(Boolean);
    const remainders = await loadRemaindersByUser(supa, userIds);

    // 사용자별 메시지
    let sentUsers = 0;
    const kstNow = fmtKST();
    for (const u of userRows) {
      const chatId = u.telegram_chat_id || process.env.TELEGRAM_CHAT_ID_BROADCAST;
      if (!chatId) continue;
      const label = u.nickname || u.user_email || `UID:${String(u.user_id).slice(0,8)}`;

      const { buys, sells, stageBudget } = planForUser({
        user: u, stage, prices: priceMap, remainders,
      });

      const buyLine = buys.length ? buys.map(b => `${b.symbol} 약 ${b.qty}주`).join(", ") : "바스켓 미설정";
      const sellLine = sells.length ? sells.map(s => `${s.symbol} ${s.qty}주`).join(", ") : "제안 없음";

      const lines = [
        `[${label}]`,
        `${kstNow} (KST)`,
        `연 납입금: ${fmtKRW(u.yearly_budget ?? u.deposit ?? 0)}`,
        rsiVal != null ? `RSI ${rsiVal.toFixed(2)} → ${stage}단계` : `${stage}단계`,
        `—`,
        `매수(단계예산 ${fmtKRW(stageBudget)}): ${buyLine}`,
        `매도 제안(잔여 30%): ${sellLine}`,
      ];

      await sendTelegram(lines.join("\n"), chatId);
      sentUsers += 1;
    }

    // 전역 alerts sent=true
    const ids = alerts.map(a => a.id);
    const { error: me } = await supa.from("alerts").update({ sent: true }).in("id", ids);
    if (me) throw me;

    return new Response(JSON.stringify({ ok: true, stage, rsi: rsiVal, sentUsers, alerts: ids.length }), {
      status: 200, headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
