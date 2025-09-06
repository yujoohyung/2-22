// app/api/kis/now/route.js
import { getKisToken } from "../../../../lib/kis.server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function miss(...keys) {
  return keys.filter((k) => !process.env[k]);
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const debug = searchParams.get("debug");
  if (!code) {
    return Response.json({ ok: false, error: "missing code" }, { status: 400 });
  }

  const missing = miss("KIS_BASE", "KIS_TOKEN_URL", "KIS_APP_KEY", "KIS_APP_SECRET");
  if (missing.length) {
    return Response.json(
      { ok: false, error: "missing env", missing },
      { status: 500 }
    );
  }

  try {
    // 1) 토큰
    const token = await getKisToken();

    // 2) 현재가 호출
    const url =
      `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price` +
      `?fid_cond_mrkt_div_code=J&fid_input_iscd=${encodeURIComponent(code)}`;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: process.env.KIS_TR_PRICE || "FHKST01010100",
        custtype: "P",
      },
      cache: "no-store",
    });

    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    if (!r.ok) {
      const code = json?.error_code || json?.code || r.status;
      const msg  = json?.error_description || json?.message || text;
      return Response.json({ ok: false, code, error: msg }, { status: r.status });
    }

    const o = json?.output || json?.output1 || {};
    const price = Number(o.stck_prpr || 0);
    const high  = Number(o.stck_hgpr || 0);

    return Response.json({ ok: true, output: { stck_prpr: price, stck_hgpr: high }, raw: debug ? json : undefined });
  } catch (e) {
    const msg = String(e?.message || e);
    // EGW00133 = 1분당 1회 토큰 발급 제한
    const isRate = msg.includes("EGW00133");
    return Response.json({ ok: false, error: msg, code: isRate ? "EGW00133" : "UNKNOWN" }, { status: isRate ? 429 : 500 });
  }
}
