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
    const text = await r.text();
    if (!r.ok) return { ok: false, status: r.status, error: text };
    
    let j = null; 
    try { j = JSON.parse(text); } catch { return { ok: false, error: "json parse fail" }; }
    
    if (j.rt_cd && j.rt_cd !== "0") {
      return { ok: false, error: j.msg1 || "kis error", json: j };
    }

    return { ok: true, json: j, raw: text, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
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
  // 200일선을 위해 넉넉히 400일 전부터 조회
  if (!/^\d{8}$/.test(start)) {
    const d = new Date(); 
    d.setDate(d.getDate() - 400); 
    start = toYmd(d);
  }
  if (start > end) [start, end] = [end, start];

  try {
    const token = await getKisToken();
    let arr = [];
    let methodUsed = "none";
    let debugRaw = null;

    // [1단계] 차트용 API (FHKST03010100) 시도
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
      const list = Array.isArray(r1.json.output2) ? r1.json.output2 : [];
      if (list.length > 150) { 
        arr = list;
        methodUsed = "chart(primary)";
        debugRaw = r1.json;
      }
    }

    // [2단계] 데이터 부족 시 -> 일반 시세 API 2번 호출 및 [중복 제거 병합]
    if (arr.length < 150) {
      const TR_ID = process.env.KIS_TR_DAILY || "FHKST01010400";
      
      // (1) 첫 번째 호출
      const ep1 =
        `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price` +
        `?fid_cond_mrkt_div_code=J` +
        `&fid_input_iscd=${enc(code)}` +
        `&fid_input_date_1=${start}` +
        `&fid_input_date_2=${end}` +
        `&fid_period_div_code=D` +
        `&fid_org_adj_prc=1`;

      const res1 = await kisGet(ep1, TR_ID, token);
      let list1 = [];
      if (res1.ok && res1.json) {
        list1 = Array.isArray(res1.json.output) ? res1.json.output : [];
      }

      // (2) 두 번째 호출
      let list2 = [];
      if (list1.length > 0) {
        const sorted1 = [...list1].sort((a, b) => b.stck_bsop_date.localeCompare(a.stck_bsop_date));
        const lastDate = sorted1[sorted1.length - 1].stck_bsop_date;
        const nextEnd = subDays(lastDate, 1);

        if (nextEnd > start) {
          const ep2 =
            `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price` +
            `?fid_cond_mrkt_div_code=J` +
            `&fid_input_iscd=${enc(code)}` +
            `&fid_input_date_1=${start}` +
            `&fid_input_date_2=${nextEnd}` +
            `&fid_period_div_code=D` +
            `&fid_org_adj_prc=1`;

          const res2 = await kisGet(ep2, TR_ID, token);
          if (res2.ok && res2.json) {
            list2 = Array.isArray(res2.json.output) ? res2.json.output : [];
          }
        }
      }

      // [중복 제거 로직 추가] 날짜(stck_bsop_date)를 키로 사용하여 중복 제거
      const merged = [...list1, ...list2];
      const uniqueMap = new Map();
      merged.forEach(item => {
        if (item.stck_bsop_date && !uniqueMap.has(item.stck_bsop_date)) {
          uniqueMap.set(item.stck_bsop_date, item);
        }
      });
      arr = Array.from(uniqueMap.values());
      
      methodUsed = `daily(fallback: merged ${list1.length}+${list2.length} -> ${arr.length})`;
      debugRaw = { note: "fallback used", r1Count: list1.length, r2Count: list2.length };
    }

    return Response.json({
      ok: true,
      output: arr, 
      used: methodUsed,
      raw: debug ? debugRaw : undefined,
    });

  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}