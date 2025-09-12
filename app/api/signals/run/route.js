// app/api/signals/run/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- 인증 ---------- */
function getSecrets(req) {
  const url = new URL(req.url);
  const headerAuth = (req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const querySecret = (url.searchParams.get("secret") || "").trim();
  const envSecret = (process.env.CRON_SECRET || "").trim();
  return { headerAuth, querySecret, envSecret, url };
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

/* ---------- 베이스 URL 계산 ---------- */
function getBase(req) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.CRON_BASE_URL) return process.env.CRON_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // 로컬/기타: 요청 origin 폴백
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

/* ---------- 내부 호출 ---------- */
async function hit(base, path) {
  const url = new URL(path, base).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${(process.env.CRON_SECRET || "").trim()}` },
    cache: "no-store",
  });
  let json = null, text = "";
  try { json = await res.clone().json(); } catch {}
  try { text = await res.text(); } catch {}
  return { url, status: res.status, json, text: text?.slice(0, 2000) };
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

  const { url } = getSecrets(req);
  const force = url.searchParams.get("force") === "1"; // run?force=1 → check에도 전달
  const base = getBase(req);

  try {
    const checkPath = force ? "/api/signals/check?force=1" : "/api/signals/check";
    const checkRes = await hit(base, checkPath);
    const dispatchRes = await hit(base, "/api/signals/dispatch");

    return new Response(
      JSON.stringify({
        ok: true,
        debug: {
          base,
          hasCRON_SECRET: Boolean(process.env.CRON_SECRET),
          siteEnv: process.env.NEXT_PUBLIC_SITE_URL || null,
          cronBaseEnv: process.env.CRON_BASE_URL || null,
        },
        check: checkRes,
        dispatch: dispatchRes,
      }),
      { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
