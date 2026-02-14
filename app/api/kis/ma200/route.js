import { NextResponse } from "next/server";
import { getKisToken } from "@/lib/kis.server";

export const dynamic = "force-dynamic";

// 오늘 날짜 문자열 (YYYYMMDD)
const getToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || "418660"; // 기본: TIGER 미국나스닥100+15%프리미엄초단기 등... (종목코드 확인 필요)
  
  // 나스닥 2배 레버리지(QLD 등)는 한국장에 없으므로, 
  // 한국장 종목코드(예: TIGER 미국나스닥100 등)를 쓰거나
  // 미국장 API를 써야 합니다. 여기서는 요청하신 '한국투자증권 국장 API' 기준으로 
  // TIGER 나스닥100(371460)이나 보유하신 종목 코드를 넣어야 합니다.
  
  try {
    const token = await getKisToken();
    const today = getToday();
    
    // 1년치 넉넉하게 요청 (휴장일 포함 200일 데이터를 채우기 위함)
    // FHKST03010100 : 주식 현재가 일자별 (일봉)
    const url = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?fid_cond_mrkt_div_code=J&fid_input_iscd=${symbol}&fid_input_date_1=20240101&fid_input_date_2=${today}&fid_period_div_code=D&fid_org_adj_prc=0`;

    const res = await fetch(url, {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: "FHKST03010100"
      },
      cache: "no-store"
    });

    const data = await res.json();
    const list = data?.output2 || data?.output || []; // output2가 보통 일봉 배열

    if (!list || list.length === 0) {
      return NextResponse.json({ ok: false, error: "데이터 없음" });
    }

    // 최신순으로 200개 자르기
    const recent200 = list.slice(0, 200);
    
    // 종가 평균 계산
    let sum = 0;
    let count = 0;
    for (const day of recent200) {
      const close = Number(day.stck_clpr); // 종가
      if (!isNaN(close)) {
        sum += close;
        count++;
      }
    }

    const ma200 = count > 0 ? sum / count : 0;

    // 현재가 (가장 최근 데이터의 종가)
    const currentPrice = Number(list[0]?.stck_clpr || 0);

    return NextResponse.json({
      ok: true,
      symbol,
      ma200,
      currentPrice,
      dataCount: count
    });

  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e.message });
  }
}