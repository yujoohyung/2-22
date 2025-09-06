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
  const code = (url.searchParams.get("code") || "418660").trim(); // 기본: TIGER 나스닥2x
  const debug = url.searchParams.get("debug") === "1";

  // 날짜 보정
  const today = toYmd(new Date());
  let start = (url.searchParams.get("start") || "").replace(/-/g, "");
  let end   = (url.searchParams.get("end")   || "").replace(/-/g, "");
  if (!/^\d{8}$/.test(end) || end > today) end = today;
  if (!/^\d{8}$/.test(start)) {
    const d = new Date(); d.setDate(d.getDate() - 400);
    start = toYmd(d);
  }
  if (start > end) [start, end] = [end, start];

  try {
    const token = await getKisToken();

    // 1) 정식 "일자별 시세" 시도 (FHKST01010400)
    const ep1 =
      `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price` +
      `?fid_cond_mrkt_div_code=J` +
      `&fid_input_iscd=${enc(code)}` +
      `&fid_input_date_1=${start}` +
      `&fid_input_date_2=${end}` +
      `&fid_period_div_code=D` +          // ✅ 중요!
      `&fid_org_adj_prc=1`;               // 수정주가(원하면 0)

    const r1 = await kisGet(ep1, process.env.KIS_TR_DAILY || "FHKST01010400", token);

    let arr = [];
    if (r1.ok && r1.json) {
      const j = r1.json;
      arr = Array.isArray(j.output) ? j.output :
            Array.isArray(j.output1) ? j.output1 : [];
    }

    // 2) 폴백: 차트용 엔드포인트 (FHKST03010100) — 계정/종목에 따라 이쪽이 잘 나옴
    let fallbackUsed = false;
    if (!arr || arr.length === 0) {
      const ep2 =
        `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` +
        `?fid_cond_mrkt_div_code=J` +
        `&fid_input_iscd=${enc(code)}` +
        `&fid_input_date_1=${start}` +
        `&fid_input_date_2=${end}` +
        `&fid_period_div_code=D` +
        `&fid_org_adj_prc=1`;

      const r2 = await kisGet(ep2, "FHKST03010100", token);
      if (r2.ok && r2.json) {
        const j2 = r2.json;
        arr = Array.isArray(j2.output) ? j2.output :
              Array.isArray(j2.output1) ? j2.output1 : [];
        if (arr && arr.length) fallbackUsed = true;
      }
    }

    return Response.json({
      ok: true,
      output: arr || [],
      used: fallbackUsed ? "fallback" : "primary",
      raw: debug ? {
        start, end, code,
        primary: r1?.json ? { rt_cd: r1.json.rt_cd, msg_cd: r1.json.msg_cd, msg1: r1.json.msg1 } : { status: r1.status },
        fallback: fallbackUsed ? "FHKST03010100" : null,
      } : undefined,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}
