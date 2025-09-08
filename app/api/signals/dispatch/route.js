// app/api/signals/dispatch/route.js
import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../../../../lib/telegram.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 표시명 매핑(A/B → 한글)
const DISPLAY_MAP = {
  A: "나스닥100 2x",
  B: "빅테크7 2x",
  NASDAQ2X: "나스닥100 2x",
  BIGTECH2X: "빅테크7 2x",
};

// KST 표기
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

// 금액 → 주수 반올림
const toQty = (krw, price) =>
  Number.isFinite(krw) && Number.isFinite(price) && price > 0
    ? Math.round(krw / price)
    : 0;

// 대시보드에서 쓰던 분배/보정 로직 그대로 재현
function calcStageKRWPerSymbol(yearlyBudget, basket, stageIndex /*0,1,2*/) {
  // 기본 가중치(60:40)
  const weights = {};
  let sumW = 0;
  for (const b of basket) {
    weights[b.symbol] = Number(b.weight || 0);
    sumW += weights[b.symbol];
  }
  if (!sumW) return {};

  // 월예상 매입금
  const monthly = {};
  for (const s of Object.keys(weights)) {
    monthly[s] = Math.round((yearlyBudget * (weights[s] / sumW)) / 12);
  }

  // 단계 비율
  const sRatios = [0.14, 0.26, 0.60];
  const factor = 0.92;
  const base = {};
  for (const s of Object.keys(monthly)) {
    base[s] = Math.round(monthly[s] * sRatios[stageIndex] * factor);
  }

  // 보정 (NASDAQ 1.6, BIGTECH 0.4과 동일한 효과: 가중 60:40 가정에서 A:1.6, B:0.4)
  const adjusted = {};
  // 기준: basket[0] = A(나스닥), basket[1] = B(빅테크)라는 가정
  const sA = basket[0]?.symbol, sB = basket[1]?.symbol;
  if (sA) adjusted[sA] = Math.round(base[sA] * 1.6);
  if (sB) adjusted[sB] = Math.round(base[sB] * 0.4);

  // 나머지 심볼 있으면 보정 없이 base 유지
  for (const s of Object.keys(base)) {
    if (!(s in adjusted)) adjusted[s] = base[s];
  }
  return adjusted;
}

export async function POST() {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 전역 설정(basket, rsi, etc.)
    const { data: sets } = await supa.from("settings").select("*").limit(1).maybeSingle();
    if (!sets) {
      return new Response(JSON.stringify({ ok: false, error: "settings not found" }), { status: 400 });
    }
    const basket = Array.isArray(sets.basket) ? sets.basket : [];
    // 가격 최신치
    const latestPrice = {};
    for (const { symbol } of basket) {
      const { data: p } = await supa
        .from("prices").select("close")
        .eq("symbol", symbol)
        .order("ts", { ascending: false })
        .limit(1).maybeSingle();
      latestPrice[symbol] = Number(p?.close || 0);
    }

    // 아직 안 보낸 전역 알림(매수/매도 신호)
    const { data: alerts, error: ae } = await supa
      .from("alerts")
      .select("*")
      .eq("sent", false)
      .order("created_at", { ascending: true });
    if (ae) throw ae;

    if (!alerts?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, note: "no pending alerts" }), { status: 200 });
    }

    // 개인 설정(연 예치금 등) 전부 불러오기
    const { data: userSets, error: ue0 } = await supa
      .from("user_settings")
      .select("*"); // service role이므로 전체 조회 가능(RLS 무시)
    if (ue0) throw ue0;

    // 유저 이메일(닉네임 없을 때 사용)
    const emails = {};
    try {
      const admin = supa.auth.admin;
      let page = 1, all = [];
      for (;;) {
        const { data } = await admin.listUsers({ page, perPage: 1000 });
        all = all.concat(data?.users || []);
        if (!data?.users?.length) break;
        page++;
      }
      for (const u of all) emails[u.id] = u.email || "";
    } catch {
      // 이메일 조회 실패 시 닉네임만 사용
    }

    // 개인 보유수량 집계(매도 30% 계산용)
    const { data: allTrades } = await supa.from("user_trades").select("*"); // service role
    const pos = new Map(); // key: `${user_id}__${symbol}` -> netQty
    for (const t of allTrades || []) {
      const k = `${t.user_id}__${t.symbol}`;
      const prev = pos.get(k) || 0;
      const delta = t.side === "SELL" ? -Number(t.qty || 0) : Number(t.qty || 0);
      pos.set(k, prev + delta);
    }

    // 텔레그램 발송 대상(채널 1곳)
    let chatId = process.env.TELEGRAM_CHAT_ID_BROADCAST || null;
    if (!chatId) {
      // settings.telegram_chat_id fallback
      const { data: s2 } = await supa.from("settings").select("telegram_chat_id").limit(1).maybeSingle();
      chatId = s2?.telegram_chat_id ?? null;
    }
    if (!chatId) throw new Error("telegram chat_id not configured");

    // === 메시지 구성 ===
    const kstNow = formatKST();
    const bigBlocks = []; // 사용자별 블록들을 모아서 하나의 텍스트로 보냄

    // alerts를 유형별로 판단
    const isBuyAlert = (a) => /단계/.test(a.level);                 // "1단계/2단계/3단계"
    const isSellAlert = (a) => /매도|리밸런싱/i.test(a.level);      // "매도/리밸런싱"

    // 가장 최신 알림 기준으로 RSI/단계를 잡되, 여러 건이면 모두 표기
    for (const us of userSets || []) {
      if (us.notify_enabled === false) continue;

      const userId = us.user_id;
      const nickname = us.nickname || emails[userId] || "(무명)";
      const budget = Number(us.yearly_budget || 0);

      const lines = [];
      lines.push(`[${nickname}] ${kstNow}`);
      lines.push(`예치금(연) ${Number(Math.round(budget)).toLocaleString("ko-KR")}원`);

      // 각 alert 처리
      for (const a of alerts) {
        // BUY: 개인 예치금 기준으로 “해당 단계” 금액 → 심볼별 금액 → 주수 반올림
        if (isBuyAlert(a)) {
          const stageIdx = Math.max(0, Math.min(2, Number(String(a.level).replace(/\D/g, "")) - 1));
          const stageKRW = calcStageKRWPerSymbol(budget, basket, stageIdx);

          // 주수 계산
          const parts = [];
          for (const { symbol } of basket) {
            const disp = DISPLAY_MAP[symbol] || symbol;
            const price = latestPrice[symbol] || 0;
            const qty = toQty(stageKRW[symbol] || 0, price);
            if (qty > 0) parts.push(`${disp} ${qty}주 매수`);
          }

          if (parts.length > 0) {
            const rsiTxt = Number(a.rsi ?? 0) ? Number(a.rsi).toFixed(2) : "-";
            lines.push(`RSI ${rsiTxt} / 매수 ${stageIdx + 1}단계`);
            for (const p of parts) lines.push(p);
          }
        }

        // SELL: 개인 보유의 30% (각 심볼별) → 1주 이상만 표기
        if (isSellAlert(a)) {
          lines.push(`최고가 / 매도`);
          for (const { symbol } of basket) {
            const disp = DISPLAY_MAP[symbol] || symbol;
            const k = `${userId}__${symbol}`;
            const net = Math.max(0, Number(pos.get(k) || 0));
            const sellQty = net > 0 ? Math.max(1, Math.floor(net * 0.3)) : 0;
            if (sellQty > 0) lines.push(`${disp} ${sellQty}주(30%) 매도`);
          }
        }
      }

      // 실제로 개인에게 줄 줄이 하나라도 생겼다면 블록 추가
      if (lines.length > 2) {
        bigBlocks.push(lines.join("\n"));
      }
    }

    if (bigBlocks.length === 0) {
      // 개인화 결과가 없어도 alerts는 전역적으로 처리 완료로 마킹(중복 방지)
      const ids = alerts.map((a) => a.id);
      await supa.from("alerts").update({ sent: true }).in("id", ids);
      return new Response(JSON.stringify({ ok: true, sent: 0, note: "no per-user messages" }), { status: 200 });
    }

    // 채널로 한 번에 보내기(사용자 블록 사이 빈줄)
    const text = bigBlocks.join("\n\n");
    await sendTelegram(text, chatId);

    // 전역 알림 sent=true
    const ids = alerts.map((a) => a.id);
    await supa.from("alerts").update({ sent: true }).in("id", ids);

    return new Response(JSON.stringify({ ok: true, users: bigBlocks.length }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e.message || e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
