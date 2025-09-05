// app/api/kis/now/route.js
import { getKisToken } from "../../../../lib/kis.server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const G = globalThis;
if (!G.__NOW_CACHE__) G.__NOW_CACHE__ = new Map(); // code -> {price, high, asOf}
const H_JSON = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function ok(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: H_JSON });
}
function bad(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: H_JSON });
}

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return bad({ ok: false, error: "missing code" });

  // 1) 토큰을 5.5초 이내에만 기다림(브라우저 Abort 7초보다 짧게)
  let token;
  try {
    token = await Promise.race([
      getKisToken(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("token_timeout")), 5500)),
    ]);
  } catch (e) {
    // 토큰 대기 타임아웃/쿨다운이면 캐시가 있으면 캐시로 즉시 응답
    const cached = G.__NOW_CACHE__.get(code);
    if (cached) {
      return ok({
        ok: true,
        output: { stck_prpr: cached.price, stck_hgpr: cached.high },
        meta: { price: cached.price, high: cached.high, cached: true },
      });
    }
    // 캐시도 없으면 조용히 패스(페이지는 ok:false면 그냥 무시)
    return bad({ ok: false, reason: String(e?.message || e) });
  }

  // 2) 한국투자 현재가 조회
  try {
    const api = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price`
      + `?fid_cond_mrkt_div_code=J&fid_input_iscd=${encodeURIComponent(code)}`;

    const res = await fetch(api, {
      method: "GET",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "authorization": `Bearer ${token}`,
        "appkey": process.env.KIS_APP_KEY,
        "appsecret": process.env.KIS_APP_SECRET,
        "tr_id": process.env.KIS_TR_PRICE || "FHKST01010100",
        "custtype": "P",
      },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      // 실패 시에도 캐시가 있으면 캐시로 응답
      const cached = G.__NOW_CACHE__.get(code);
      if (cached) {
        return ok({
          ok: true,
          output: { stck_prpr: cached.price, stck_hgpr: cached.high },
          meta: {
            price: cached.price,
            high: cached.high,
            cached: true,
            source: "cache_on_error",
            status: res.status,
          },
        });
      }
      return bad({ ok: false, status: res.status, body: text?.slice(0, 300) });
    }

    let j = {};
    try { j = JSON.parse(text); } catch {}
    const o = j?.output || j?.output1 || j || {};
    const price = Number(o.stck_prpr || o.prpr || 0);
    const high  = Number(o.stck_hgpr || o.hgpr || 0);

    if (price > 0) G.__NOW_CACHE__.set(code, { price, high, asOf: Date.now() });

    return ok({ ok: true, output: o, meta: { price, high } });
  } catch (e) {
    // 예외 시에도 캐시가 있으면 캐시로 응답
    const cached = G.__NOW_CACHE__.get(code);
    if (cached) {
      return ok({
        ok: true,
        output: { stck_prpr: cached.price, stck_hgpr: cached.high },
        meta: { price: cached.price, high: cached.high, cached: true, source: "cache_on_exception" },
      });
    }
    return bad({ ok: false, reason: String(e?.message || e) });
  }
}
