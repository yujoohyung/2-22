// app/api/cron/check-signals/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// 환경변수: 서비스롤/봇토큰/기본 URL
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
// 크론이 내부 API를 호출할 절대주소. Vercel이면 배포 URL, 로컬이면 http://localhost:3000
const BASE = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// 심볼/가중치(페이지와 동일)
const CODE = { NASDAQ2X: "418660", BIGTECH2X: "465610" };
const WEIGHT = { NASDAQ2X: 0.6, BIGTECH2X: 0.4 };

// Cutler RSI / SMA
function rsiCutler(values: number[], period = 14) {
  const n = values.length, out = Array(n).fill(null) as (number|null)[];
  if (n < period + 1) return out;
  const g = Array(n).fill(0), l = Array(n).fill(0);
  for (let i = 1; i < n; i++) { const d = values[i] - values[i-1]; g[i] = d>0?d:0; l[i] = d<0?-d:0; }
  let sg = 0, sl = 0; for (let i=1;i<=period;i++){ sg+=g[i]; sl+=l[i]; }
  let ag = sg/period, al = sl/period;
  out[period] = al===0?100:ag===0?0:100-100/(1+ag/al);
  for (let i=period+1;i<n;i++){ sg+=g[i]-g[i-period]; sl+=l[i]-l[i-period]; ag=sg/period; al=sl/period; out[i]=al===0?100:ag===0?0:100-100/(1+ag/al); }
  return out;
}
function sma(values: number[], window: number) {
  const n = values.length, out = Array(n).fill(null) as (number|null)[];
  if (n < window) return out;
  let sum = 0; for (let i=0;i<window;i++) sum += values[i];
  out[window-1] = sum/window;
  for (let i=window;i<n;i++){ sum += values[i]-values[i-window]; out[i]=sum/window; }
  return out;
}
const toKST = (d=new Date()) => new Date(d.getTime() + 9*60*60*1000);
const fmtDateTimeKST = (d=new Date()) => {
  const k = toKST(d);
  const y=k.getUTCFullYear(), m=String(k.getUTCMonth()+1).padStart(2,"0"), day=String(k.getUTCDate()).padStart(2,"0");
  const hh=String(k.getUTCHours()).padStart(2,"0"), mm=String(k.getUTCMinutes()).padStart(2,"0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
};

async function fetchDaily(code: string) {
  const pad = (n:number)=>String(n).padStart(2,"0");
  const now = new Date();
  const end = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const s = new Date(now); s.setDate(s.getDate()-400);
  const start = `${s.getFullYear()}${pad(s.getMonth()+1)}${pad(s.getDate())}`;
  const res = await fetch(`${BASE}/api/kis/daily?code=${code}&start=${start}&end=${end}`, { cache:"no-store" });
  if (!res.ok) throw new Error("daily http "+res.status);
  const d = await res.json();
  const out = d.output || d.output1 || [];
  const rows = (Array.isArray(out)?out:[]).map((x:any)=>({
    date: x.stck_bsop_date || x.bstp_nmis || x.date,
    close: Number(x.stck_clpr || x.tdd_clsprc || x.close),
    prev:  Number(x.prdy_clpr || x.prev)
  })).filter((r:any)=>r.date && Number.isFinite(r.close));
  rows.sort((a:any,b:any)=>a.date.localeCompare(b.date));
  return rows;
}
async function fetchNow(code: string) {
  const res = await fetch(`${BASE}/api/kis/now?code=${code}`, { cache:"no-store" });
  if (!res.ok) return { price: 0, high: 0 };
  const d = await res.json(); const o = d.output || {};
  return { price: Number(o.stck_prpr || 0), high: Number(o.stck_hgpr || 0) };
}

function stageFromRSI(rsi: number|null|undefined, levels: number[]) {
  if (rsi == null) return null;
  const [L1,L2,L3] = levels; // 예: [43,36,30]
  if (rsi <= L3) return 3;
  if (rsi <= L2) return 2;
  if (rsi <= L1) return 1;
  return null;
}

async function sendTelegram(chatId: string, text: string) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  }).catch(()=>{});
}

export async function GET() {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  // 1) 모든 사용자 설정 로드 (서비스 롤은 RLS 우회)
  const { data: settings, error } = await supa
    .from("settings")
    .select("*")
    .eq("notify_enabled", true);

  if (error) return NextResponse.json({ ok:false, error: error.message }, { status: 500 });
  if (!settings || settings.length === 0) return NextResponse.json({ ok:true, msg:"no users" });

  // 2) 신호(나스닥 RSI 기준) + 현재가 조회
  const dailyNas = await fetchDaily(CODE.NASDAQ2X);
  const closeN = dailyNas.map(r=>r.close);
  const rsiN = rsiCutler(closeN, 14);
  const ma200N = sma(closeN, 200);
  const lastIdx = dailyNas.length - 1;
  const lastRSI = (rsiN[lastIdx] ?? null) as number|null;
  const below200 = ma200N[lastIdx] != null && closeN[lastIdx] < (ma200N[lastIdx] as number);

  const nowN = await fetchNow(CODE.NASDAQ2X);
  const nowB = await fetchNow(CODE.BIGTECH2X);

  const nowTxt = fmtDateTimeKST(new Date());

  // 3) 사용자별 알림 생성
  const results:any[] = [];
  for (const s of settings) {
    const levels: number[] = Array.isArray(s.rsi_buy_levels) ? s.rsi_buy_levels : [43,36,30];
    const stageAmounts: number[] = Array.isArray(s.stage_amounts_krw) ? s.stage_amounts_krw : [0,0,0];
    const stg = stageFromRSI(lastRSI, levels);

    // 매수 신호가 없으면 스킵(매도는 연 1회 200일선 옵션)
    if (!stg && !below200) { results.push({ email:s.user_email, skipped:true }); continue; }

    // 중복 방지: 최근 60분 내 동일 레벨 알림 여부
    const { data: recent } = await supa
      .from("alerts")
      .select("id, created_at, level")
      .gte("created_at", new Date(Date.now()-60*60*1000).toISOString())
      .order("created_at", { ascending:false })
      .limit(1);
    const already = recent?.some(r => (stg ? `${stg}단계` : "리밸런싱") === r.level) ?? false;
    if (already) { results.push({ email:s.user_email, dedup:true }); continue; }

    let text = `${nowTxt}\n`;
    if (stg) {
      const amountTotal = stageAmounts[stg-1] || 0;
      const amtN = Math.round(amountTotal * WEIGHT.NASDAQ2X);
      const amtB = Math.round(amountTotal * WEIGHT.BIGTECH2X);
      const qtyN = nowN.price > 0 ? Math.max(1, Math.floor(amtN / nowN.price)) : 0;
      const qtyB = nowB.price > 0 ? Math.max(1, Math.floor(amtB / nowB.price)) : 0;

      text += `RSI ${lastRSI?.toFixed(2)} / 매수${stg}단계\n\n`;
      text += `나스닥100 2x ${qtyN}주 매수\n빅테크7 2x ${qtyB}주 매수`;

      // alerts 적재
      await supa.from("alerts").insert({
        symbol: "NASDAQ2X",
        rsi: lastRSI ?? 0,
        level: `${stg}단계`,
        message: text,
        sent: !!s.telegram_chat_id
      });

      if (s.telegram_chat_id) await sendTelegram(s.telegram_chat_id, text);
    }

    // (선택) 매도 신호: 200일선 하회 & 올해 최초
    if (!stg && below200) {
      // 올해 이미 보낸 매도(리밸런싱) 있는지
      const thisYearStart = new Date(new Date().getFullYear(),0,1).toISOString();
      const { data: sentThisYear } = await supa
        .from("alerts").select("id").gte("created_at", thisYearStart).eq("level","리밸런싱").limit(1);
      if (!sentThisYear || sentThisYear.length === 0) {
        text += `리밸런싱(200일선 하회)\n\n`;
        text += `나스닥100 2x 보유수량의 30% 매도\n빅테크7 2x 보유수량의 30% 매도`;
        await supa.from("alerts").insert({
          symbol: "NASDAQ2X",
          rsi: lastRSI ?? 0,
          level: "리밸런싱",
          message: text,
          sent: !!s.telegram_chat_id
        });
        if (s.telegram_chat_id) await sendTelegram(s.telegram_chat_id, text);
      }
    }

    results.push({ email:s.user_email, ok:true });
  }

  return NextResponse.json({ ok:true, results });
}
