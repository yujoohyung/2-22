// app/api/signals/dispatch/route.js
import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../../../../lib/telegram.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 한국시간 포맷 */
function formatKST(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const y = k.getUTCFullYear();
  const m = p(k.getUTCMonth() + 1);
  const d = p(k.getUTCDate());
  const hh = p(k.getUTCHours());
  const mm = p(k.getUTCMinutes());
  return `${y}-${m}-${d} ${hh}시 ${mm}분`;
}

/** 이메일 → 짧은 표시명 */
const shortName = (email) => (email ? String(email).split("@")[0] : "사용자");

/** 숫자 포맷 */
const fmt = (n) => Number(n ?? 0).toLocaleString("ko-KR");

/** 사용자 보유수량 집계: user_trades에서 (BUY-SELL) */
async function loadUserPositions(supa, symbols) {
  // 트레이드 전부 가져와도 유저 2~4명 규모면 충분
  const { data: rows, error } = await supa
    .from("user_trades")
    .select("user_id, symbol, side, qty");
  if (error) throw error;

  const pos = new Map(); // key: `${user_id}__${symbol}` -> remQty
  for (const r of rows || []) {
    if (!symbols.includes(r.symbol)) continue;
    const key = `${r.user_id}__${r.symbol}`;
    const prev = pos.get(key) || 0;
    const q = Number(r.qty || 0);
    pos.set(key, prev + (r.side === "BUY" ? q : -q));
  }
  return pos; // remQty(음수면 0으로 다룸)
}

/** Supabase Auth 사용자 목록 (id -> email) */
async function loadUsersEmailMap(supa) {
  // service role로만 가능
  const { data, error } = await supa.auth.admin.listUsers();
  if (error) throw error;
  const map = new Map();
  for (const u of data?.users || []) {
    if (u?.id) map.set(u.id, u.email || "");
  }
  return map;
}

/** 최신 가격 맵 (심볼 -> close) */
async function loadPriceMap(supa, symbols) {
  const map = new Map();
  for (const s of symbols) {
    const { data: p } = await supa
      .from("prices")
      .select("close")
      .eq("symbol", s)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    map.set(s, Number(p?.close || 0));
  }
  return map;
}

/** 사용자의 단계별 예산(원) 결정
 * - settings.stage_amounts_krw가 있으면 그걸 1/2/3단계로 사용
 * - 없으면 deposit * [0.06, 0.06, 0.08] (예시) 로 Fallback
 */
function getStageBudgetKRW(settingsRow, levelIndex) {
  const L = Number(levelIndex); // 0,1,2
  if (Array.isArray(settingsRow?.stage_amounts_krw)) {
    const v = Number(settingsRow.stage_amounts_krw[L] ?? 0);
    return Number.isFinite(v) ? v : 0;
  }
  // fallback: deposit * ladder (기본)
  const dep = Number(settingsRow?.deposit || 0);
  const ladder = (settingsRow?.ladder?.buy_pct) || [0.06, 0.06, 0.08];
  const pct = Number(ladder[L] ?? 0);
  return Math.round(dep * pct);
}

/** (매수) 사용자별 바스켓 수량 계산 */
function computeUserBuyPlan(settingsRow, levelIndex, priceMap) {
  const stageKRW = getStageBudgetKRW(settingsRow, levelIndex); // 단계별 총원
  const basket = Array.isArray(settingsRow?.basket) ? settingsRow.basket : [];
  if (!basket.length || stageKRW <= 0) return [];

  // 가중치 합
  const wsum = basket.reduce((s, b) => s + Number(b.weight || 0), 0) || 1;

  const plans = [];
  for (const b of basket) {
    const sym = b.symbol;
    const w = Number(b.weight || 0) / wsum;
    const krw = Math.round(stageKRW * w);
    const px = Number(priceMap.get(sym) || 0);
    const qty = px > 0 ? Math.max(0, Math.round(krw / px)) : 0;
    plans.push({ symbol: sym, krw, price: px, qty });
  }
  return plans;
}

/** (매도) 사용자별 잔여*0.3 매도 수량 계산 */
function computeUserSellPlan(userId, symbols, posMap) {
  const out = [];
  for (const sym of symbols) {
    const key = `${userId}__${sym}`;
    const rem = Math.max(0, Number(posMap.get(key) || 0));
    const sellQty = rem > 0 ? Math.max(1, Math.floor(rem * 0.3)) : 0;
    if (sellQty > 0) out.push({ symbol: sym, sellQty, rem });
  }
  return out;
}

export async function GET() { return POST(); }

export async function POST() {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // A) 아직 안 보낸 알림들(전역) — 매수/매도 신호 소스
    const { data: alerts, error: ae } = await supa
      .from("alerts")
      .select("*")
      .eq("sent", false)
      .order("created_at", { ascending: true });
    if (ae) throw ae;

    // 알림 없으면 조용히 종료
    if (!alerts?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // B) 모든 사용자 settings (개인별 예치금/바스켓/단계예산/채널 ID)
    const { data: settingsRows, error: se } = await supa
      .from("settings")
      .select("*");
    if (se) throw se;
    const users = settingsRows || [];
    if (!users.length) throw new Error("no settings rows");

    // C) 바스켓에 등장하는 모든 심볼 수집 → 가격맵
    const allSymbols = Array.from(
      new Set(
        users.flatMap((u) =>
          (Array.isArray(u?.basket) ? u.basket : []).map((b) => b.symbol)
        )
      )
    );
    const priceMap = await loadPriceMap(supa, allSymbols);

    // D) user_trades → 보유수량(잔여) 맵 + id→email 맵
    const posMap = await loadUserPositions(supa, allSymbols);
    const id2email = await loadUsersEmailMap(supa);

    // E) 알림 묶음 파악: (간단히) 최신 레벨/RSI/created_at
    //   - 같은 패스에서 여러 심볼이 insert 되었을 가능성 → level/created_at 기준으로 메시지 제목 구성
    const top = alerts[0];
    const rsiVal = Number(top?.rsi ?? 0);
    const levelText = String(top?.level || "");
    const isSellSignal = /매도|리밸/i.test(levelText); // '매도' or '리밸런싱' 등

    // F) 발송 대상 chat_id (채널 하나로 방송)
    let chatId = process.env.TELEGRAM_CHAT_ID_BROADCAST || null;
    if (!chatId) {
      // fallback: 첫 사용자 settings.telegram_chat_id
      chatId = users.find((u) => u.telegram_chat_id)?.telegram_chat_id ?? null;
    }
    if (!chatId) throw new Error("telegram chat_id not configured");

    // G) 메시지 만들기
    const lines = [];
    lines.push(`${formatKST()}`);

    if (!isSellSignal) {
      // ===== 매수 신호 =====
      lines.push(`RSI ${rsiVal.toFixed(2)} / ${levelText} (개인 예치금 기준 수량)`);

      // levelIndex: '1단계','2단계','3단계' → 0/1/2
      const levelIndex =
        /1/.test(levelText) ? 0 : /2/.test(levelText) ? 1 : /3/.test(levelText) ? 2 : 0;

      for (const u of users) {
        const uname = shortName(u.user_email);
        const plans = computeUserBuyPlan(u, levelIndex, priceMap);

        // 심볼 → 보기좋은 라벨(원하면 바꿔도 됨)
        const label = (s) =>
          s === "A" ? "나스닥100 2x" :
          s === "B" ? "빅테크7 2x"   :
          s; // 그대로

        const parts = [];
        for (const p of plans) {
          parts.push(`${label(p.symbol)} ${fmt(p.qty)}주`);
        }
        const dep = Number(u.deposit || 0);
        lines.push(`- ${uname} / 1년 납입금: ${fmt(dep)}원 / ${parts.join(" / ")}`);
      }
    } else {
      // ===== 매도 신호 =====
      lines.push(`(매도 신호) ${levelText}`);

      // 각 사용자별로 잔여*0.3
      for (const u of users) {
        const uname = shortName(u.user_email);
        const sellPlan = computeUserSellPlan(u.user_id || "", allSymbols, posMap);

        if (!sellPlan.length) {
          lines.push(`- ${uname} / 보유수량 없음`);
          continue;
        }

        // 심볼 라벨
        const label = (s) =>
          s === "A" ? "나스닥100 2x" :
          s === "B" ? "빅테크7 2x"   :
          s;

        const parts = [];
        for (const sp of sellPlan) {
          parts.push(`${label(sp.symbol)} ${fmt(sp.sellQty)}주(잔여 ${fmt(sp.rem)}주)`);
        }
        lines.push(`- ${uname} / ${parts.join(" / ")}`);
      }
    }

    const text = lines.join("\n");

    // H) 발송
    await sendTelegram(text, chatId);

    // I) sent=true 마킹
    const ids = alerts.map((a) => a.id);
    const { error: ue } = await supa.from("alerts").update({ sent: true }).in("id", ids);
    if (ue) throw ue;

    return new Response(JSON.stringify({ ok: true, sent: ids.length }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    // 실패해도 에러만 찍고 500
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
