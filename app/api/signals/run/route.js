// app/api/signals/run/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return true;                           // 시크릿 없으면 개방
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;       // 헤더 허용
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true; // ?secret= 허용
  return false;
}

function baseUrlFrom(req) {
  // CRON_BASE_URL > NEXT_PUBLIC_SITE_URL > VERCEL_URL > 현재 요청 기준
  const u =
    process.env.CRON_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return u || new URL("/", req.url).origin;
}

async function callJSON(url, init) {
  const r = await fetch(url, init);
  let body;
  try { body = await r.json(); } catch { body = await r.text(); }
  return { status: r.status, body };
}

export async function GET(req) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const base = baseUrlFrom(req);

  // 1) RSI 체크 → alerts 생성
  const check = await callJSON(`${base}/api/signals/check`, { method: "POST" });

  // 2) 텔레그램 발송 → alerts.sent=true
  const dispatch = await callJSON(`${base}/api/signals/dispatch`, { method: "POST" });

  return new Response(JSON.stringify({ ok: true, base, check, dispatch }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(req) { return GET(req); }
