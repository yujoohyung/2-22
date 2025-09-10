// app/api/signals/run/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authCheck(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: true, reason: "no-secret-configured" };

  const url = new URL(req.url);
  const q = url.searchParams.get("secret") || "";
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";

  const ok = q === secret || bearer === secret;
  return { ok, reason: ok ? "match" : "mismatch" };
}

export async function GET(req) { return POST(req); }

export async function POST(req) {
  const a = authCheck(req);
  if (!a.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }

  const url = new URL(req.url);
  const base =
    process.env.CRON_BASE_URL || `${url.protocol}//${url.host}`;

  const out = {};

  try {
    const r1 = await fetch(`${base}/api/signals/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });
    out.check = { status: r1.status, body: await r1.text() };
  } catch (e) {
    out.check = { error: String(e?.message || e) };
  }

  try {
    const r2 = await fetch(`${base}/api/signals/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });
    out.dispatch = { status: r2.status, body: await r2.text() };
  } catch (e) {
    out.dispatch = { error: String(e?.message || e) };
  }

  return new Response(JSON.stringify({ ok: true, ...out }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
