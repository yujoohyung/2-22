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
    
    // API 응답 코드가 성공이 아닌 경우 체크 (KIS는 200 OK 내에서도 rt_cd로 에러를 줄 때가 있음)
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

    // =================================================================
    // [1단계] 차트용 API (FHKST03010100) 시도
    // =================================================================
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
      // output2가 과거 데이터 배열임
      const list = Array.isArray(j.output2) ? j.output2 : [];
      if (list.length > 150) { // 데이터가 충분하면 바로 사용
        arr = list;
        methodUsed = "chart(primary)";
        debugRaw = r1.json;
      }
    }

    // =================================================================
    // [2단계] 차트 API 실패 혹은 데이터 부족 시 -> 일반 시세 API 2번 호출 (이어붙이기)
    // =================================================================
    if (arr.length < 150) {
      const TR_ID = process.env.KIS_TR_DAILY || "FHKST01010400";
      
      // (1) 첫 번째 호출: 최신 데이터 100개 (end 기준)
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

      // (2) 두 번째 호출: 첫 번째 데이터의 가장 과거 날짜보다 이전 데이터 요청
      let list2 = [];
      if (list1.length > 0) {
        // list1의 마지막 항목이 가장 과거 날짜임 (보통 내림차순 정렬되어 옴)
        // 날짜가 오름차순/내림차순 섞일 수 있으니 정렬 후 확인
        const sorted1 = [...list1].sort((a, b) => b.stck_bsop_date.localeCompare(a.stck_bsop_date));
        const lastDate = sorted1[sorted1.length - 1].stck_bsop_date;
        const nextEnd = subDays(lastDate, 1); // 하루 전

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

      // 두 결과 병합 (중복 제거는 클라이언트에서 정렬하며 처리됨, 여기선 단순 병합)
      arr = [...list1, ...list2];
      methodUsed = `daily(fallback: ${list1.length}+${list2.length})`;
      debugRaw = { note: "fallback used", r1: res1.json, r2: list2.length };
    }

    // 최종 결과 반환
    return Response.json({
      ok: true,
      output: arr, // 클라이언트가 output 필드를 참조함
      used: methodUsed,
      raw: debug ? debugRaw : undefined,
    });

  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}