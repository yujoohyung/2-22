// app/api/signals/run/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  return run(req);
}
export async function POST(req) {
  return run(req);
}

async function run(req) {
  try {
    // 실행 베이스: CRON_BASE_URL > NEXT_PUBLIC_SITE_URL > 현재 오리진
    const origin =
      process.env.CRON_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      new URL(req.url).origin;

    // (선택) CRON_SECRET 사용 시 Authorization 헤더 부여
    const headers = {};
    if (process.env.CRON_SECRET) {
      headers["Authorization"] = `Bearer ${process.env.CRON_SECRET}`;
    }

    const logs = [];
    async function call(path, method = "POST") {
      const url = `${origin}${path}`;
      const res = await fetch(url, { method, headers, cache: "no-store" });
      const text = await res.text().catch(() => "");
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      logs.push({ path, status: res.status, body });
      return { status: res.status, body };
    }

    // 순서: check → dispatch
    const a = await call("/api/signals/check", "POST");
    const b = await call("/api/signals/dispatch", "POST");

    return new Response(
      JSON.stringify({
        ok: true,
        now: new Date().toISOString(),
        origin,
        results: { check: a, dispatch: b },
      }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
