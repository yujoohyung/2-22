import { NextResponse } from "next/server";
import { getKisToken } from "@/lib/kis.server";

export const dynamic = "force-dynamic";

/* 한국 시간(KST) 기준 YYYYMMDD 반환 (서버 타임존 영향 X) */
const getKSTDateString = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  
  // 한국 시간대로 포맷팅 (예: 2024. 02. 15.)
  const kstStr = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);

  // "2024. 02. 15." -> "20240215" 변환
  return kstStr.replace(/\. /g, "").replace(/\./g, "");
};

/* RSI 계산 (14일) */
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  const reversed = [...prices].reverse(); // 과거 -> 현재
  
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

    // 1. 기간 설정 (오늘 ~ 730일전)
    const strEnd = getKSTDateString(0);
    const strStart = getKSTDateString(-730);

    // 2. [API 1] 일봉 데이터
    const urlDaily = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}&fid_input_date_1=${strStart}&fid_input_date_2=${strEnd}&fid_period_div_code=D&fid_org_adj_prc=0`;
    const resDaily = await fetch(urlDaily, { headers, tr_id: "FHKST03010100", cache: "no-store" });
    const dataDaily = await resDaily.json();
    let items = dataDaily?.output2 || []; 

    // 3. [API 2] 실시간 현재가 (일봉 데이터 보정용)
    const urlNow = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}`;
    const resNow = await fetch(urlNow, { headers, tr_id: "FHKST01010100", cache: "no-store" });
    const dataNow = await resNow.json();
    const currentPrice = Number(dataNow?.output?.stck_prpr || 0);

    // 4. 데이터 병합 (차트 데이터가 없어도 현재가로 최대한 계산)
    if (items.length === 0) {
        // 차트가 아예 없으면 현재가만이라도 반환
        return NextResponse.json({ ok: true, symbol, price: currentPrice, ma200: 0, rsi: null });
    }

    // 최신 데이터 보정 (현재가가 있고, 차트 최신가와 다르면 업데이트)
    if (currentPrice > 0) {
       items[0].stck_clpr = String(currentPrice);
    }

    // 5. MA200 & RSI 계산
    const recent200 = items.slice(0, 200);
    let ma200 = 0;
    if (recent200.length > 0) {
      let sum = 0;
      for (const day of recent200) sum += Number(day.stck_clpr);
      ma200 = sum / recent200.length;
    }

    const rsiSource = items.slice(0, 100).map(i => Number(i.stck_clpr));
    const rsi = calculateRSI(rsiSource, 14);

    return NextResponse.json({
      ok: true,
      symbol,
      price: currentPrice || Number(items[0].stck_clpr),
      ma200,
      rsi,
      date: items[0].stck_bsop_date
    });

  } catch (e) {
    console.error("MA200 API Error:", e);
    return NextResponse.json({ ok: false, error: e.message });
  }
}