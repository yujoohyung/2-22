import { NextResponse } from "next/server";
import { getKisToken } from "@/lib/kis.server";

export const dynamic = "force-dynamic";

/* [수정] 서버 환경 타지 않는 강력한 한국 날짜 구하기 */
const getKSTDateString = (offsetDays = 0) => {
  const now = new Date();
  // 현재 UTC 시간 계산
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  // 한국 시간(KST) = UTC + 9시간
  const kstGap = 9 * 60 * 60 * 1000;
  const kstDate = new Date(utc + kstGap);
  
  // 날짜 더하기/빼기
  kstDate.setDate(kstDate.getDate() + offsetDays);

  const y = kstDate.getFullYear();
  const m = String(kstDate.getMonth() + 1).padStart(2, "0");
  const d = String(kstDate.getDate()).padStart(2, "0");
  
  return `${y}${m}${d}`; // 예: "20240215"
};

/* RSI 계산 함수 (14일) */
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  const reversed = [...prices].reverse(); // 과거 -> 현재 순으로 정렬
  
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

    // 1. 기간 설정 (넉넉하게 2년)
    const strEnd = getKSTDateString(0);      // 오늘
    const strStart = getKSTDateString(-730); // 2년 전

    console.log(`[MA200] Fetching ${symbol} (${strStart} ~ ${strEnd})`);

    // 2. 일봉 차트 & 현재가 동시 요청 (속도 향상 및 안전성)
    const urlDaily = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}&fid_input_date_1=${strStart}&fid_input_date_2=${strEnd}&fid_period_div_code=D&fid_org_adj_prc=0`;
    const urlNow = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}`;

    const [resDaily, resNow] = await Promise.allSettled([
      fetch(urlDaily, { headers, tr_id: "FHKST03010100", cache: "no-store" }),
      fetch(urlNow, { headers, tr_id: "FHKST01010100", cache: "no-store" })
    ]);

    // 3. 데이터 파싱
    let items = [];
    let currentPrice = 0;

    // 일봉 데이터 처리
    if (resDaily.status === "fulfilled" && resDaily.value.ok) {
      const data = await resDaily.value.json();
      items = data?.output2 || []; 
    } else {
      console.error("[MA200] Daily Chart Fetch Failed");
    }

    // 현재가 데이터 처리
    if (resNow.status === "fulfilled" && resNow.value.ok) {
      const data = await resNow.value.json();
      currentPrice = Number(data?.output?.stck_prpr || 0);
    } else {
      console.error("[MA200] Current Price Fetch Failed");
    }

    // 4. 데이터가 아예 없는 경우 (최악의 상황)
    if (items.length === 0 && currentPrice === 0) {
      return NextResponse.json({ ok: false, error: "데이터 조회 실패 (장 시작 전이거나 API 오류)" });
    }

    // 5. 데이터 보정 (차트 최신화)
    if (items.length > 0 && currentPrice > 0) {
      // 차트의 최신 데이터(items[0]) 가격을 실시간 가격으로 덮어씀 (RSI 정확도 향상)
      items[0].stck_clpr = String(currentPrice);
    } else if (items.length === 0 && currentPrice > 0) {
      // 차트가 깨졌는데 현재가만 있는 경우 -> 최소한 현재가라도 리턴
      return NextResponse.json({ ok: true, symbol, price: currentPrice, ma200: 0, rsi: null });
    }

    // 6. 지표 계산
    // MA200
    const recent200 = items.slice(0, 200);
    let ma200 = 0;
    if (recent200.length > 0) {
      let sum = 0;
      for (const day of recent200) sum += Number(day.stck_clpr);
      ma200 = sum / recent200.length;
    }

    // RSI
    const rsiSource = items.slice(0, 100).map(i => Number(i.stck_clpr));
    const rsi = calculateRSI(rsiSource, 14);

    // 최종 반환
    return NextResponse.json({
      ok: true,
      symbol,
      price: currentPrice || Number(items[0].stck_clpr), // 현재가 우선, 없으면 차트 종가
      ma200,
      rsi,
      date: items[0].stck_bsop_date
    });

  } catch (e) {
    console.error("[MA200] Critical Error:", e);
    return NextResponse.json({ ok: false, error: e.message });
  }
}