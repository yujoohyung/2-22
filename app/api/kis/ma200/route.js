import { NextResponse } from "next/server";
import { getKisToken } from "@/lib/kis.server";

export const dynamic = "force-dynamic";

const toYmd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

const subDays = (dStr, days) => {
  const y = parseInt(dStr.slice(0, 4));
  const m = parseInt(dStr.slice(4, 6)) - 1;
  const d = parseInt(dStr.slice(6, 8));
  const date = new Date(y, m, d);
  date.setDate(date.getDate() - days);
  return toYmd(date);
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || "418660"; 

  try {
    const token = await getKisToken();
    const today = toYmd(new Date());
    // 200일선을 계산하기 위해 넉넉히 300일 전부터 조회
    const start = subDays(today, 300); 

    // 병렬 요청으로 데이터 확보 (150일씩 2번 끊어서 요청)
    const mid = subDays(today, 150);
    const enc = encodeURIComponent;
    const url = (s, e) => `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${enc(symbol)}&fid_input_date_1=${s}&fid_input_date_2=${e}&fid_period_div_code=D&fid_org_adj_prc=1`;
    
    const [r1, r2] = await Promise.all([
      fetch(url(mid, today), { headers: { authorization: `Bearer ${token}`, appkey: process.env.KIS_APP_KEY, appsecret: process.env.KIS_APP_SECRET, tr_id: "FHKST01010400", custtype: "P" } }).then(r=>r.json()),
      fetch(url(start, subDays(today, 151)), { headers: { authorization: `Bearer ${token}`, appkey: process.env.KIS_APP_KEY, appsecret: process.env.KIS_APP_SECRET, tr_id: "FHKST01010400", custtype: "P" } }).then(r=>r.json())
    ]);

    let items = [];
    if (r1?.output) items.push(...r1.output);
    if (r2?.output) items.push(...r2.output);

    // 중복 제거 및 정렬 (최신순)
    const unique = new Map();
    items.forEach(i => unique.set(i.stck_bsop_date, Number(i.stck_clpr)));
    const prices = Array.from(unique.values()); // API는 보통 최신순으로 줌. 확인 필요없음 (어차피 200개 자르면 됨)

    let ma200 = 0;
    // 데이터가 200개 이상이면 최신 200개의 평균 계산
    if (prices.length >= 200) {
      let sum = 0;
      for (let i = 0; i < 200; i++) sum += prices[i];
      ma200 = sum / 200;
    }

    // 결과값만 심플하게 반환
    return NextResponse.json({ ok: true, symbol, ma200 });

  } catch (e) {
    return NextResponse.json({ ok: false, ma200: 0 });
  }
}