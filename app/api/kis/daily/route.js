import { getKisToken } from "../../../../lib/kis.server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const enc = encodeURIComponent;

// YYYYMMDD 변환
const toYmd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

// 날짜 계산
const subDays = (dStr, days) => {
  const y = parseInt(dStr.slice(0, 4));
  const m = parseInt(dStr.slice(4, 6)) - 1;
  const d = parseInt(dStr.slice(6, 8));
  const date = new Date(y, m, d);
  date.setDate(date.getDate() - days);
  return toYmd(date);
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
  
  const today = toYmd(new Date());
  let start = (url.searchParams.get("start") || "").replace(/-/g, "");
  let end = (url.searchParams.get("end") || "").replace(/-/g, "");
  
  if (!/^\d{8}$/.test(end) || end > today) end = today;
  // [수정] 기본값을 짧게(150일) 잡아서 속도 향상
  if (!/^\d{8}$/.test(start)) {
    start = subDays(today, 150);
  }
  if (start > end) [start, end] = [end, start];

  try {
    const token = await getKisToken();
    let arr = [];

    // 1. 차트 API (가장 빠름)
    const epChart =
      `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` +
      `?fid_cond_mrkt_div_code=J&fid_input_iscd=${enc(code)}&fid_input_date_1=${start}&fid_input_date_2=${end}&fid_period_div_code=D&fid_org_adj_prc=1`;

    const r1 = await kisGet(epChart, "FHKST03010100", token);
    
    if (r1.ok && Array.isArray(r1.json.output2) && r1.json.output2.length > 0) {
      arr = r1.json.output2;
    } else {
      // 2. 실패 시 일반 시세 API (Fallback)
      const ep =
        `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price` +
        `?fid_cond_mrkt_div_code=J&fid_input_iscd=${enc(code)}&fid_input_date_1=${start}&fid_input_date_2=${end}&fid_period_div_code=D&fid_org_adj_prc=1`;
      
      const r2 = await kisGet(ep, "FHKST01010400", token);
      if (r2.ok && Array.isArray(r2.json.output)) {
        arr = r2.json.output;
      }
    }

    // 날짜 오름차순 정렬 (과거 -> 현재)
    // * KIS 차트 API는 내림차순으로 줄 때가 많으므로 확인 필요
    // 여기선 클라이언트 편의를 위해 일단 그대로 둠 (클라이언트에서 정렬함)

    return Response.json({ ok: true, output: arr });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message) });
  }
}