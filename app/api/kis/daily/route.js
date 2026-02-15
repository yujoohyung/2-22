// app/api/kis/daily/route.js
import { getKisToken } from "../../../../lib/kis.server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const enc = encodeURIComponent;
const toYmd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

/** KIS 호출 공통 */
async function kisGet(ep, trId, token) {
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
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { ok: r.ok, json: j, raw: text, status: r.status };
}

export async function GET(req) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "418660").trim();
  const debug = url.searchParams.get("debug") === "1";

  // 날짜 보정
  const today = toYmd(new Date());
  let start = (url.searchParams.get("start") || "").replace(/-/g, "");
  let end   = (url.searchParams.get("end")   || "").replace(/-/g, "");
  if (!/^\d{8}$/.test(end) || end > today) end = today;
  if (!/^\d{8}$/.test(start)) {
    const d = new Date(); d.setDate(d.getDate() - 400); // 200일선 넉넉히
    start = toYmd(d);
  }
  if (start > end) [start, end] = [end, start];

  try {
    const token = await getKisToken();
    let arr = [];
    let methodUsed = "none";
    let debugRaw = null;

    // 1순위: 차트용 API (FHKST03010100)
    // 장점: 한 번에 많은 데이터(수백 일 치)를 조회 가능
    const epChart =
      `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` +
      `?fid_cond_mrkt_div_code=J` +
      `&fid_input_iscd=${enc(code)}` +
      `&fid_input_date_1=${start}` +
      `&fid_input_date_2=${end}` +
      `&fid_period_div_code=D` +
      `&fid_org_adj_prc=1`;

    const r1 = await kisGet(epChart, "FHKST03010100", token);

    if (r1.ok && r1.json) {
      const j = r1.json;
      // [핵심 수정] output2 (과거 데이터 배열)를 가장 먼저 확인
      // output1은 현재가 1개만 들어있으므로, 이걸 먼저 잡으면 200일선 계산 불가
      arr = Array.isArray(j.output2) ? j.output2 :
            Array.isArray(j.output1) ? j.output1 : 
            Array.isArray(j.output) ? j.output : [];
      
      if (arr.length > 0) {
        methodUsed = "chart(primary)";
        debugRaw = r1.json;
      }
    }

    // 2순위: 차트 API 실패 시 일반 시세 API (FHKST01010400) 시도 (폴백)
    if (arr.length === 0) {
      const epDaily =
        `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price` +
        `?fid_cond_mrkt_div_code=J` +
        `&fid_input_iscd=${enc(code)}` +
        `&fid_input_date_1=${start}` +
        `&fid_input_date_2=${end}` +
        `&fid_period_div_code=D` +
        `&fid_org_adj_prc=1`;

      const r2 = await kisGet(epDaily, process.env.KIS_TR_DAILY || "FHKST01010400", token);
      if (r2.ok && r2.json) {
        const j2 = r2.json;
        arr = Array.isArray(j2.output) ? j2.output :
              Array.isArray(j2.output1) ? j2.output1 : [];
        methodUsed = "daily(fallback)";
        debugRaw = r2.json;
      }
    }

    return Response.json({
      ok: true,
      output: arr || [],
      used: methodUsed,
      raw: debug ? debugRaw : undefined,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}