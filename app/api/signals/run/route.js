// app/api/signals/run/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── 디버그 로그: Vercel Function Logs 에 찍힘 ─────────────────────────────
function isAuthorized(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  const url = new URL(req.url);
  const q = url.searchParams.get("secret");

  const secret = process.env.CRON_SECRET || "";

  console.log("[RUN] has env CRON_SECRET? ", secret ? "YES" : "NO");
  if (secret) console.log("[RUN] env head: ", secret.slice(0, 2) + "***");
  console.log("[RUN] auth header: ", header ? header.slice(0, 20) + "***" : "(none)");
  console.log("[RUN] query secret: ", q ? q.slice(0, 2) + "***" : "(none)");

  if (!secret) return false;               // 서버에 비밀이 없으면 거절
  if (token && token === secret) return true;
  if (q && q === secret) return true;
  return false;
}

export async function GET(req) { return POST(req); }

export async function POST(req) {
  try {
    // 1) 권한 체크 (헤더 or ?secret=)
    if (!isAuthorized(req)) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    // 2) 내부로 check → dispatch 순서 호출
    const base =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.CRON_BASE_URL ||
      `https://${process.env.VERCEL_URL || "localhost:3000"}`;

    console.log("[RUN] base =", base);

    async function hit(path) {
      const r = await fetch(new URL(path, base), {
        method: "POST",
        // 굳이 필요는 없지만, 헤더를 그대로 넘겨도 무해
        headers: { Authorization: req.headers.get("authorization") || "" },
        cache: "no-store",
      });
      let body = {};
      try { body = await r.json(); } catch {}
      return { status: r.status, body };
    }

    const checkRes = await hit("/api/signals/check");
    const dispatchRes = await hit("/api/signals/dispatch");

    const out = { ok: true, check: checkRes, dispatch: dispatchRes };
    return new Response(JSON.stringify(out), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    console.error("[RUN] error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
