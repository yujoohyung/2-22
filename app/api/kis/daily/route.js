// app/api/kis/daily/route.js
import { getKisToken } from "../../../../lib/kis.server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const G = globalThis;
if (!G.__KIS_DAILY_CACHE__) G.__KIS_DAILY_CACHE__ = new Map(); // 쿼리별 60초 캐시

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const code  = searchParams.get("code");
    const start = searchParams.get("start"); // YYYYMMDD (선택)
    const end   = searchParams.get("end");   // YYYYMMDD (선택)
    if (!code) return new Response("missing code", { status: 400 });

    const cacheKey = `daily:${code}:${start || ""}:${end || ""}`;
    const hit = G.__KIS_DAILY_CACHE__.get(cacheKey);
    if (hit && Date.now() - hit.ts < 60_000) {
      return Response.json(hit.data);
    }

    const token = await getKisToken();

    // KIS 일자별 시세 엔드포인트
    // fid_cond_mrkt_div_code=J (주식), fid_input_iscd=종목, fid_period_div_code=D(일봉), fid_org_adj_prc=1(수정주가 반영)
    const base = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-price`;
    const qs = new URLSearchParams({
      fid_cond_mrkt_div_code: "J",
      fid_input_iscd: code,
      fid_period_div_code: "D",
      fid_org_adj_prc: "1",
    });
    // (KIS는 start/end 직접 파라미터가 아니라, 조회 결과를 잘라서 쓰는 구조라 보통 기간필터는 클라이언트에서 후처리)
    const url = `${base}?${qs.toString()}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: process.env.KIS_TR_DAILY || "FHKST01010400",
        custtype: "P",
      },
      cache: "no-store",
    });

    const txt = await res.text();
    if (!res.ok) {
      console.error("KIS daily error", res.status, txt);
      return new Response("kis daily error", { status: 500 });
    }

    let j = {};
    try { j = JSON.parse(txt); } catch {}
    // output/output1 둘 다 고려
    const arr = Array.isArray(j?.output) ? j.output : (Array.isArray(j?.output1) ? j.output1 : []);
    // 날짜/종가 필드 정규화
    const rows = arr.map((x) => ({
      date:  x.stck_bsop_date || x.bstp_nmis || x.date,
      close: Number(x.stck_clpr || x.tdd_clsprc || x.close),
      prev:  Number(x.prdy_clpr || x.prev || 0),
    })).filter(r => r.date && Number.isFinite(r.close));

    const out = { ok: true, output: rows };

    G.__KIS_DAILY_CACHE__.set(cacheKey, { ts: Date.now(), data: out });
    return Response.json(out);
  } catch (e) {
    console.error("KIS daily thrown:", e);
    return new Response("server error", { status: 500 });
  }
}
