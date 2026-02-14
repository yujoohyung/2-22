import { NextResponse } from "next/server";
import { getKisToken } from "@/lib/kis.server";

export const dynamic = "force-dynamic";

/* 한국 시간(KST) 기준 날짜 문자열 (YYYYMMDD) 반환 */
const getKSTDateString = (offsetDays = 0) => {
  const now = new Date();
  // UTC 시간을 KST(UTC+9)로 변환
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kstGap = 9 * 60 * 60 * 1000;
  const kstDate = new Date(utc + kstGap);
  
  if (offsetDays !== 0) {
    kstDate.setDate(kstDate.getDate() + offsetDays);
  }

  const y = kstDate.getFullYear();
  const m = String(kstDate.getMonth() + 1).padStart(2, "0");
  const d = String(kstDate.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

/* RSI 계산 (14일) */
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;

  // prices[0]이 최신이라고 가정 -> 계산을 위해 시간순(과거->현재)으로 뒤집기
  const reversed = [...prices].reverse();
  
  let gains = 0;
  let losses = 0;

  // 첫 period의 평균 등락
  for (let i = 1; i <= period; i++) {
    const change = reversed[i] - reversed[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // 이후 데이터로 RSI 갱신
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

    // 1. 기간 설정 (오늘 ~ 2년전)
    // 주말이라도 '오늘' 날짜로 요청하면 API가 알아서 최근 거래일 데이터를 줍니다.
    const strEnd = getKSTDateString(0);      // 오늘
    const strStart = getKSTDateString(-730); // 2년 전

    // 2. [API 1] 일봉 차트 데이터 요청
    const urlDaily = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}&fid_input_date_1=${strStart}&fid_input_date_2=${strEnd}&fid_period_div_code=D&fid_org_adj_prc=0`;
    
    const resDaily = await fetch(urlDaily, { headers, tr_id: "FHKST03010100", cache: "no-store" });
    const dataDaily = await resDaily.json();
    let items = dataDaily?.output2 || []; // index 0이 최신 날짜

    // 3. [API 2] 실시간 현재가 요청 (보완용)
    const urlNow = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}`;
    const resNow = await fetch(urlNow, { headers, tr_id: "FHKST01010100", cache: "no-store" });
    const dataNow = await resNow.json();
    const currentPrice = Number(dataNow?.output?.stck_prpr || 0);

    // 4. 데이터 보정 로직
    // 차트 데이터가 없으면 비상 종료
    if (items.length === 0) {
      return NextResponse.json({ ok: true, symbol, price: currentPrice, ma200: 0, rsi: null });
    }

    // 만약 장중이라서 차트(일봉)의 최신 종가가 아직 업데이트 안 됐다면
    // 현재가를 이용해서 오늘자 데이터를 갱신하거나 추가해줌.
    const lastDate = items[0].stck_bsop_date; // 차트의 가장 최신 날짜 (예: 20240213)
    const todayDate = getKSTDateString(0);    // 오늘 날짜 (예: 20240215)

    // (케이스 A) 오늘이 평일이고 장중인데, 차트에는 어제까지만 있을 때 -> 오늘 데이터 추가
    // (케이스 B) 오늘이 주말(15일)이고, 차트는 금요일(13일)까지 있을 때 -> 그대로 사용 (추가 X)
    
    // 만약 현재가가 존재하고, 차트의 최신 종가와 많이 다르다면(장중 변동), 
    // 차트의 최신 종가를 현재가로 덮어씌워주는 것이 더 정확한 RSI 계산에 도움이 됩니다.
    // 단, 날짜가 다를 때 무조건 추가하면 주말에 '오늘(일요일)' 데이터가 생겨버리므로 주의.
    
    // 결론: 가장 심플하고 강력한 방법
    // -> items[0] (가장 최근 거래일)의 종가를 '현재 조회된 실시간 가격'으로 업데이트합니다.
    // (장 마감 후나 주말에는 실시간 가격 = 최근 종가이므로 안전함)
    if (currentPrice > 0) {
       items[0].stck_clpr = String(currentPrice);
    }

    // 5. MA200 계산 (최신 200개)
    const recent200 = items.slice(0, 200);
    let ma200 = 0;
    if (recent200.length > 0) {
      let sum = 0;
      for (const day of recent200) sum += Number(day.stck_clpr);
      ma200 = sum / recent200.length;
    }

    // 6. RSI 계산 (최근 100개 사용)
    const rsiSource = items.slice(0, 100).map(i => Number(i.stck_clpr));
    const rsi = calculateRSI(rsiSource, 14);

    return NextResponse.json({
      ok: true,
      symbol,
      price: currentPrice || Number(items[0].stck_clpr),
      ma200,
      rsi,
      date: items[0].stck_bsop_date // 기준이 된 날짜
    });

  } catch (e) {
    console.error("MA200 API Error:", e);
    return NextResponse.json({ ok: false, error: e.message });
  }
}