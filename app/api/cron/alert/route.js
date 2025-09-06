// app/api/cron/alert/route.js
import { createClient } from "@supabase/supabase-js";

// --- 유틸
const enc = encodeURIComponent;
const to2 = (n) => String(n).padStart(2, "0");
const KST = () => {
  const now = new Date();
  const k = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
  return k;
};
const fmtKST = (d) => `${d.getFullYear()}-${to2(d.getMonth()+1)}-${to2(d.getDate())} ${to2(d.getHours())}시 ${to2(d.getMinutes())}분`;

// RSI (Cutler)
function calcRSI(closes = [], period = 14) {
  const n = closes.length;
  if (!n || n < period + 1) return null;
  const gains = Array(n).fill(0), losses = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = Number(closes[i]) - Number(closes[i-1]);
    gains[i] = d > 0 ? d : 0; losses[i] = d < 0 ? -d : 0;
  }
  let sumG = 0, sumL = 0;
  for (let i = 1; i <= period; i++) { sumG += gains[i]; sumL += losses[i]; }
  let avgG = sumG/period, avgL = sumL/period;
  let rsi = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100/(1 + (avgG/avgL));
  for (let i = period + 1; i < n; i++) {
    sumG += gains[i] - gains[i - period];
    sumL += losses[i] - losses[i - period];
    avgG = sumG/period; avgL = sumL/period;
    rsi = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100/(1 + (avgG/avgL));
  }
  return rsi;
}

// 단계 판정: [43,36,30] → 0/1/2 (1/2/3단계), 미충족 -1
function decideBuyLevel(rsi, levels=[43,36,30]) {
  if (rsi <= levels[2]) return 2;
  if (rsi <= levels[1]) return 1;
  if (rsi <= levels[0]) return 0;
  return -1;
}

// 바스켓 수량 계산: stage_amounts_krw[level] * weight / price
function computeBasketQuantities(settings, level, priceMap) {
  const stageAmts = Array.isArray(settings.stage_amounts_krw) ? settings.stage_amounts_krw : [120000,240000,552000];
  const basket = Array.isArray(settings.basket) ? settings.basket : [];
  const allocKRW = Number(stageAmts[level] || 0);
  const out = [];
  for (const { symbol, weight } of basket) {
    const p = Number(priceMap[symbol] || 0);
    const krw = Math.round(allocKRW * Number(weight || 0));
    const qty = p > 0 ? Math.max(1, Math.round(krw / p)) : 0;
    out.push({ symbol, krw, price: p, qty });
  }
  return out;
}

// 체크시각 검사 (KST)
function isCheckTimeKST(whitelist = ["10:30","14:30"], toleranceMin = 2) {
  const now = KST();
  const hhmm = `${to2(now.getHours())}:${to2(now.getMinutes())}`;
  if (whitelist.includes(hhmm)) return true;
  // 약간의 허용(± toleranceMin) — 안전장치
  const padList = new Set();
  for (const t of whitelist) {
    const [H, M] = t.split(":").map(x=>+x);
    for (let d=-toleranceMin; d<=toleranceMin; d++) {
      const m = H*60+M+d;
      const h2 = Math.floor((m+1440)%1440/60);
      const m2 = (m+1440)%60;
      padList.add(`${to2(h2)}:${to2(m2)}`);
    }
  }
  return padList.has(hhmm);
}

// 텔레그램 전송
async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID_BROADCAST;
  if (!token || !chatId) throw new Error("TELEGRAM env missing");
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const j = await r.json().catch(()=>null);
  if (!r.ok || !j?.ok) throw new Error("telegram send failed: " + JSON.stringify(j||{}));
  return j;
}

// 심볼 → 표시이름(원하면 바꿔도 됨)
const DISPLAY = { A: "나스닥100 2x", B: "빅테크7 2x" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1"; // 강제 실행용

    // 0) 설정 읽기
    const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
    const { data: sets } = await supa.from("settings").select("*").limit(1).maybeSingle();
    if (!sets) return Response.json({ ok:false, reason:"no-settings" }, { status:200 });

    const buyLevels = sets.rsi_buy_levels || [43,36,30];
    const checkTimes = sets.rsi_check_times || ["10:30","14:30"];
    const main = sets.main_symbol || "A";
    const basket = Array.isArray(sets.basket) ? sets.basket : [];

    // 1) 시간 필터 (vercel 크론이면 사실상 통과지만, 수동호출 보호)
    if (!force && !isCheckTimeKST(checkTimes, 2)) {
      return Response.json({ ok:true, skip:"not-check-time" }, { status:200 });
    }

    // 2) main 심볼 종가들 → RSI
    const { data: aPrices } = await supa
      .from("prices")
      .select("ts, close")
      .eq("symbol", main)
      .order("ts", { ascending: false })
      .limit(300);

    const closes = (aPrices||[])
      .sort((x,y)=> new Date(x.ts)-new Date(y.ts))
      .map(x=> Number(x.close))
      .filter(Number.isFinite);

    const rsi = calcRSI(closes, sets.rsi_period || 14);
    if (rsi == null) return Response.json({ ok:false, reason:"not-enough-price" }, { status:200 });

    const level = decideBuyLevel(rsi, buyLevels);
    if (level < 0) {
      // 매수조건 미달 → 끝
      return Response.json({ ok:true, rsi, level:-1, sent:false }, { status:200 });
    }

    // 3) 최신가 맵 (바스켓 모든 심볼)
    const priceMap = {};
    for (const { symbol } of basket) {
      const { data: p } = await supa
        .from("prices")
        .select("close")
        .eq("symbol", symbol)
        .order("ts", { ascending:false })
        .limit(1)
        .maybeSingle();
      priceMap[symbol] = Number(p?.close || 0);
    }

    // 4) 수량 산출 → alerts insert (중복 방지)
    const plans = computeBasketQuantities(sets, level, priceMap);

    // 중복 방지: 최근 10분 내 동일 단계 알림이 있으면 skip
    const since = new Date(Date.now() - 10*60*1000).toISOString();
    const { data: dup } = await supa
      .from("alerts")
      .select("id")
      .gte("created_at", since)
      .eq("level", `${level+1}단계`)
      .limit(1);

    if (dup && dup.length) {
      return Response.json({ ok:true, rsi, level, skip:"duplicate" }, { status:200 });
    }

    // DB 기록(알림 로그)
    const created = [];
    for (const plan of plans) {
      const msg = `RSI ${rsi.toFixed(2)} (<= ${buyLevels[level]}) → ${level+1}단계: ${plan.symbol} 약 ${plan.qty}주 (예산 ${plan.krw.toLocaleString()}원)`;
      const { data: ins } = await supa.from("alerts").insert({
        symbol: plan.symbol, rsi, level: `${level+1}단계`, message: msg, sent: false
      }).select().single();
      if (ins) created.push(ins);
    }

    // 5) 텔레그램 메시지 구성 & 발송
    const now = KST();
    let lines = [];
    lines.push(`${fmtKST(now)}`);
    lines.push(`RSI ${rsi.toFixed(2)} / 매수${level+1}단계`);
    lines.push("");
    for (const p of plans) {
      const name = DISPLAY[p.symbol] || p.symbol;
      lines.push(`${name} ${p.qty}주 매수`);
    }
    const text = lines.join("\n");
    await sendTelegram(text);

    // sent 표시
    const ids = created.map(x=>x.id);
    if (ids.length) {
      await supa.from("alerts").update({ sent:true }).in("id", ids);
    }

    return Response.json({ ok:true, rsi, level, sent:true, text }, { status:200 });
  } catch (e) {
    return Response.json({ ok:false, error:String(e?.message||e) }, { status:200 });
  }
}
