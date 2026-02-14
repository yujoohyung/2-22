import { NextResponse } from "next/server";
import { getKisToken } from "@/lib/kis.server";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol"); // 종목코드 (예: 418660)

  // 편의상 심볼 매핑 (사용자가 NASDAQ2X라고 보내면 실제 종목코드로 변환)
  // 실제 사용하시는 종목코드로 변경해주세요.
  let code = symbol;
  if (symbol === "NASDAQ2X") code = "418660"; // 예시: TIGER 미국나스닥100레버리지(합성) 등 실제 코드
  if (symbol === "BIGTECH2X") code = "418660"; // 예시 코드 (수정 필요)

  if (!code) return NextResponse.json({ price: 0 });

  try {
    const token = await getKisToken();
    
    // 주식 현재가 시세 (FHKST01010100)
    const url = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${code}`;
    
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: "FHKST01010100"
      },
      cache: "no-store"
    });

    const data = await res.json();
    const price = Number(data?.output?.stck_prpr || 0); // stck_prpr: 현재가

    return NextResponse.json({ price });
  } catch (e) {
    console.error("Price API Error:", e);
    return NextResponse.json({ price: 0 });
  }
}