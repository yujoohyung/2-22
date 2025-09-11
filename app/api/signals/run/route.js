// app/api/signals/run/route.js

export async function POST(req) {
  // ...
  const secret = (process.env.CRON_SECRET || "").trim();
  const authHeader = `Bearer ${secret}`;

  // ✅ 프리뷰 URL(VERCEL_URL) 쓰지 말고, 현재 요청의 origin 사용
  const base =
    process.env.NEXT_PUBLIC_SITE_URL     // (있으면 가장 우선) 예: https://2xbuysell.vercel.app
    || new URL(req.url).origin;          // (없으면) 지금 요청이 들어온 도메인

  console.log("[RUN] base =", base);

  async function hit(path) {
    const url = new URL(path, base);
    // (선택) 쿼리로도 넘기고 싶으면:
    // url.searchParams.set("secret", secret);

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,        // ✅ 내부 엔드포인트도 통과 가능
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });

    let body = {};
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }

  const checkRes = await hit("/api/signals/check");
  const dispatchRes = await hit("/api/signals/dispatch");

  return new Response(JSON.stringify({ ok: true, check: checkRes, dispatch: dispatchRes }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
