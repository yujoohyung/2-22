import { NextResponse } from "next/server";
import { getKisToken } from "@/lib/kis.server";

export const dynamic = "force-dynamic";

/* 한국 시간 구하기 (서버 시간대 이슈 방지) */
const getKSTDateString = (offsetDays = 0) => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kstGap = 9 * 60 * 60 * 1000;
  const kstDate = new Date(utc + kstGap);
  kstDate.setDate(kstDate.getDate() + offsetDays);

  const y = kstDate.getFullYear();
  const m = String(kstDate.getMonth() + 1).padStart(2, "0");
  const d = String(kstDate.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

/* RSI 계산 (전체 데이터 사용) */
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  const reversed = [...prices].reverse();
  
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = reversed[i] - reversed[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < reversed.length; i++) {
    const change = reversed[i] - reversed[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || "418660"; 

  try {
    const token = await getKisToken();
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET
    };

    // 2년치 데이터 요청 (RSI 정확도 확보)
    const strEnd = getKSTDateString(0);
    const strStart = getKSTDateString(-730);

    // Promise.all로 동시에 요청해서 속도 최적화 (결과는 하나로 합침)
    const urlDaily = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}&fid_input_date_1=${strStart}&fid_input_date_2=${strEnd}&fid_period_div_code=D&fid_org_adj_prc=0`;
    const urlNow = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}`;

    const [resDaily, resNow] = await Promise.allSettled([
      fetch(urlDaily, { headers, tr_id: "FHKST03010100", cache: "no-store" }),
      fetch(urlNow, { headers, tr_id: "FHKST01010100", cache: "no-store" })
    ]);

    let items = [];
    let currentPrice = 0;

    if (resDaily.status === "fulfilled" && resDaily.value.ok) {
      const data = await resDaily.value.json();
      items = data?.output2 || []; 
    }
    if (resNow.status === "fulfilled" && resNow.value.ok) {
      const data = await resNow.value.json();
      currentPrice = Number(data?.output?.stck_prpr || 0);
    }

    // 데이터가 전혀 없으면 에러 반환
    if (items.length === 0 && currentPrice === 0) {
      return NextResponse.json({ ok: false, error: "데이터 없음" });
    }

    // 최신가 보정
    if (items.length > 0 && currentPrice > 0) {
      items[0].stck_clpr = String(currentPrice);
    }

    // MA200 계산 (데이터 200개 이상일 때만)
    const recent200 = items.slice(0, 200);
    let ma200 = 0;
    if (recent200.length >= 200) { 
      let sum = 0;
      for (const day of recent200) sum += Number(day.stck_clpr);
      ma200 = sum / 200;
    }

    // RSI 계산 (전체 데이터 사용)
    const rsiSource = items.map(i => Number(i.stck_clpr));
    const rsi = calculateRSI(rsiSource, 14);

    // [중요] 클라이언트에게는 딱 하나의 객체만 보냄
    return NextResponse.json({
      ok: true,
      symbol,
      price: currentPrice || Number(items[0]?.stck_clpr || 0),
      ma200,
      rsi,
      date: items[0]?.stck_bsop_date
    });

  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}