// app/api/kis/daily/route.js
import { getKisToken } from "../../../../lib/kis.server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const enc = encodeURIComponent;

// YYYYMMDD 변환
const toYmd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

// 날짜 계산 (d - days)
const subDays = (dStr, days) => {
  const y = parseInt(dStr.slice(0, 4));
  const m = parseInt(dStr.slice(4, 6)) - 1;
  const d = parseInt(dStr.slice(6, 8));
  const date = new Date(y, m, d);
  date.setDate(date.getDate() - days);
  return toYmd(date);
};

// 날짜 차이 계산 (일수)
const diffDays = (start, end) => {
  const y1 = parseInt(start.slice(0, 4)), m1 = parseInt(start.slice(4, 6)) - 1, d1 = parseInt(start.slice(6, 8));
  const y2 = parseInt(end.slice(0, 4)), m2 = parseInt(end.slice(4, 6)) - 1, d2 = parseInt(end.slice(6, 8));
  return (new Date(y2, m2, d2) - new Date(y1, m1, d1)) / (1000 * 60 * 60 * 24);
};

/** KIS 호출 공통 */
async function kisGet(ep, trId, token) {
  try {
    const r = await fetch(ep, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: trId,
        custtype: "P",
      },
      cache: "no-store",
    });
    if (!r.ok) return { ok: false };
    const j = await r.json();
    if (j.rt_cd && j.rt_cd !== "0") return { ok: false, msg: j.msg1 };
    return { ok: true, json: j };
  } catch (e) {
    return { ok: false };
  }
}

export async function GET(req) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "418660").trim();
  const debug = url.searchParams.get("debug") === "1";

  const today = toYmd(new Date());
  let start = (url.searchParams.get("start") || "").replace(/-/g, "");
  let end = (url.searchParams.get("end") || "").replace(/-/g, "");
  
  if (!/^\d{8}$/.test(end) || end > today) end = today;
  // 200일선을 위해 넉넉히 400일 전부터 조회
  if (!/^\d{8}$/.test(start)) {
    start = subDays(today, 400);
  }
  if (start > end) [start, end] = [end, start];

  try {
    const token = await getKisToken();
    let arr = [];
    let methodUsed = "none";

    // 1. [Fast Track] 차트 API 시도 (가장 빠름)
    const epChart =
      `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` +
      `?fid_cond_mrkt_div_code=J&fid_input_iscd=${enc(code)}&fid_input_date_1=${start}&fid_input_date_2=${end}&fid_period_div_code=D&fid_org_adj_prc=1`;

    const r1 = await kisGet(epChart, "FHKST03010100", token);
    if (r1.ok && Array.isArray(r1.json.output2) && r1.json.output2.length > 150) {
      arr = r1.json.output2;
      methodUsed = "chart(primary)";
    } 
    else {
      // 2. [Fallback] 일반 시세 API 병렬 호출 (속도 개선 핵심)
      // 데이터를 순서대로 받지 않고, 기간을 3등분해서 동시에 쏩니다.
      const TR_ID = process.env.KIS_TR_DAILY || "FHKST01010400";
      
      // 기간 설정 (겹치게 설정해서 누락 방지)
      const end1 = end;
      const start1 = subDays(end1, 100);
      const end2 = subDays(end1, 101);
      const start2 = subDays(end1, 220);
      const end3 = subDays(end1, 221);
      const start3 = start; // 나머지 전체

      const makeUrl = (s, e) => 
        `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price` +
        `?fid_cond_mrkt_div_code=J&fid_input_iscd=${enc(code)}&fid_input_date_1=${s}&fid_input_date_2=${e}&fid_period_div_code=D&fid_org_adj_prc=1`;

      // 3개를 동시에(Promise.all) 요청 -> 시간 단축
      const results = await Promise.all([
        kisGet(makeUrl(start1, end1), TR_ID, token),
        kisGet(makeUrl(start2, end2), TR_ID, token),
        kisGet(makeUrl(start3, end3), TR_ID, token)
      ]);

      let merged = [];
      results.forEach(res => {
        if (res.ok && Array.isArray(res.json.output)) {
          merged.push(...res.json.output);
        }
      });

      // 중복 제거 (Map 사용)
      const uniqueMap = new Map();
      merged.forEach(item => {
        if (item.stck_bsop_date && !uniqueMap.has(item.stck_bsop_date)) {
          uniqueMap.set(item.stck_bsop_date, item);
        }
      });
      
      // 날짜순 정렬 (내림차순)
      arr = Array.from(uniqueMap.values()).sort((a, b) => b.stck_bsop_date.localeCompare(a.stck_bsop_date));
      methodUsed = `daily(parallel: ${results.length} requests)`;
    }

    return Response.json({ ok: true, output: arr, used: methodUsed });

  } catch (e) {
    return Response.json({ ok: false, error: String(e.message) }, { status: 200 });
  }
}