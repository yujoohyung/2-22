export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../../../../lib/telegram";
import { normSymbol } from "../../../../lib/symbols";
import { computeBasketQuantities } from "../../../../lib/formulas"; // ✅ 여기 사용

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
    const sym = normSymbol(symbol);
    const { data } = await supa
      .from("prices").select("close, ts")
      .eq("symbol", sym).order("ts", { ascending: false }).limit(1).maybeSingle();
    out[sym] = Number(data?.close || 0);
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
    const uid = t.user_id, sym = normSymbol(t.symbol), q = Number(t.qty || 0);
    if (!rem[uid]) rem[uid] = {}; if (!rem[uid][sym]) rem[uid][sym] = 0;
    if (t.side === "BUY") rem[uid][sym] += q; else if (t.side === "SELL") rem[uid][sym] -= q;
  }
  for (const uid of Object.keys(rem)) for (const sym of Object.keys(rem[uid])) rem[uid][sym] = Math.max(0, rem[uid][sym]);
  return rem;
}

export async function POST() {
  try {
    const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    const { data: alerts, error: ae } = await supa
      .from("alerts").select("*").eq("sent", false).order("created_at", { ascending: true });
    if (ae) throw ae;
    if (!alerts?.length) return new Response(JSON.stringify({ ok: true, msg: "no alerts" }), { status: 200 });

    const sum = summarizeAlerts(alerts);
    const stage = sum?.stage ?? 1;
    const rsiVal = sum?.rsi ?? null;

    const { data: allowedUsers, error: ue } = await supa
      .from("v_user_settings_allowed")
      .select("user_id, user_email, nickname, telegram_chat_id, notify_enabled, yearly_budget, deposit, basket, stage_amounts_krw, stage_amounts_by_symbol");
    if (ue) throw ue;
    const userRows = (allowedUsers || []).filter(u => u?.notify_enabled !== false);

    const symbols = new Set();
    for (const u of userRows) (Array.isArray(u.basket) ? u.basket : []).forEach(b => b?.symbol && symbols.add(normSymbol(b.symbol)));
    alerts.forEach(a => a?.symbol && symbols.add(normSymbol(a.symbol)));
    const priceMap = await loadLatestPrices(supa, Array.from(symbols));

    const userIds = userRows.map(u => u.user_id).filter(Boolean);
    const remainders = await loadRemaindersByUser(supa, userIds);

    const kstNow = fmtKST();
    const blocks = [];
    for (const u of userRows) {
      const label = u.nickname || u.user_email || `UID:${String(u.user_id).slice(0,8)}`;
      // ✅ formulas.computeBasketQuantities 사용 (심볼 정규화/가중치 분배)
      const stageAmts = Array.isArray(u.stage_amounts_krw) && u.stage_amounts_krw.length
        ? u.stage_amounts_krw : DEF_STAGE_AMOUNTS;
      const buys = computeBasketQuantities({ basket: u.basket || [], stage_amounts_krw: stageAmts }, Math.max(0, Math.min(stage-1, 2)), priceMap);

      const rem = remainders[u.user_id] || {};
      const sells = Object.keys(rem).map((symbol) => {
        const sym = normSymbol(symbol);
        const rq = Number(rem[sym] || 0);
        const qty = rq > 0 ? Math.max(1, Math.floor(rq * 0.3)) : 0;
        return { symbol: sym, remQty: rq, qty };
      }).filter(x => x.qty > 0);

      const buyLine = buys.length ? buys.map(b => `${b.symbol.toUpperCase()} 약 ${b.qty}주`).join(", ") : "바스켓 미설정";
      const sellLine = sells.length ? sells.map(s => `${s.symbol.toUpperCase()} ${s.qty}주`).join(", ") : "제안 없음";

      blocks.push([
        `[${label}]`,
        `${kstNow} (KST)`,
        `연 납입금: ${fmtKRW(u.yearly_budget ?? u.deposit ?? 0)}`,
        rsiVal != null ? `RSI ${rsiVal.toFixed(2)} → ${stage}단계` : `${stage}단계`,
        `매수(단계예산 ${fmtKRW(stageAmts[Math.max(0, Math.min(stage-1, 2))])}): ${buyLine}`,
        `매도 제안(잔여 30%): ${sellLine}`,
      ].join("\n"));
    }

    if (blocks.length) {
      const header = `[알림] ${kstNow} (KST)\n${rsiVal != null ? `RSI ${rsiVal.toFixed(2)} → ${stage}단계` : `${stage}단계`}\n—`;
      const text = [header, ...blocks].join("\n\n—\n\n");
      await sendTelegram(text, process.env.TELEGRAM_CHAT_ID_BROADCAST);
    }

    const ids = alerts.map(a => a.id);
    const { error: me } = await supa.from("alerts").update({ sent: true }).in("id", ids);
    if (me) throw me;

    return new Response(JSON.stringify({ ok: true, stage, rsi: rsiVal, sentUsers: userRows.length, alerts: ids.length }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
}
