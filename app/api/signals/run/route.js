export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSecrets(req) {
  const url = new URL(req.url);
  const headerAuth = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const querySecret = (url.searchParams.get("secret") || "").trim();
  const envSecret = (process.env.CRON_SECRET || "").trim(); // 공백/개행 제거
  return { headerAuth, querySecret, envSecret };
}

function isAuthorized(req) {
  const { headerAuth, querySecret, envSecret } = getSecrets(req);
  if (!envSecret) return { ok: false, reason: "no-env-secret" };
  const ok = headerAuth === envSecret || querySecret === envSecret;
  return ok
    ? { ok: true }
    : {
        ok: false,
        reason: "mismatch",
        expectedLen: envSecret.length,
        headerLen: headerAuth.length,
        queryLen: querySecret.length,
      };
}

export async function GET(req) { return POST(req); }

export async function POST(req) {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized", ...auth }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // 최소한 뭔가가 바로 보이도록, 내부 호출 전 상태 먼저 찍어줌
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.CRON_BASE_URL ||
    `https://${process.env.VERCEL_URL}`;

  async function hit(path) {
    const url = new URL(path, base).toString();
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      cache: "no-store",
    });
    let json = null, text = "";
    try { json = await r.clone().json(); } catch {}
    try { text = await r.text(); } catch {}
    return { url, status: r.status, json, text: text?.slice(0, 2000) };
  }

  try {
    const checkRes = await hit("/api/signals/check");
    const dispatchRes = await hit("/api/signals/dispatch");

    return new Response(JSON.stringify({
      ok: true,
      debug: {
        base,
        hasCRON_SECRET: !!process.env.CRON_SECRET,
        siteEnv: process.env.NEXT_PUBLIC_SITE_URL || null,
        cronBaseEnv: process.env.CRON_BASE_URL || null,
      },
      check: checkRes,
      dispatch: dispatchRes,
    }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }});
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
