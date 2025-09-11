// app/api/signals/run/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 권한 체크(헤더 or 쿼리)
function isAuthorized(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const q = new URL(req.url).searchParams.get("secret");
  const secret = process.env.CRON_SECRET || "";
  return !!secret && (token === secret || q === secret);
}

export async function GET(req) { return POST(req); }

export async function POST(req) {
  try {
    if (!isAuthorized(req)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // 내부 호출 베이스
    const base =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.CRON_BASE_URL ||
      `https://${process.env.VERCEL_URL}`;

    // 디버그용: 뭘로 호출하는지 응답에 그대로 담아줌
    const debug = {
      base,
      hasCRON_SECRET: !!process.env.CRON_SECRET,
      envSite: process.env.NEXT_PUBLIC_SITE_URL || null,
      envCronBase: process.env.CRON_BASE_URL || null,
    };

    // 내부 API를 치되, 응답 본문을 반드시 텍스트로도 확보
    const hit = async (path) => {
      const url = new URL(path, base).toString();
      const r = await fetch(url, {
        method: "POST",
        headers: {
          // run → check/dispatch 로도 같은 토큰을 넘겨줌(있어도 되고 없어도 됨)
          Authorization: req.headers.get("authorization") || "",
          "cache-control": "no-store",
        },
      });
      let json = null, text = "";
      try { json = await r.clone().json(); } catch {}
      try { text = await r.text(); } catch {}
      return { url, status: r.status, json, text };
    };

    const checkRes = await hit("/api/signals/check");
    const dispatchRes = await hit("/api/signals/dispatch");

    return new Response(
      JSON.stringify({ ok: true, debug, check: checkRes, dispatch: dispatchRes }),
      { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
