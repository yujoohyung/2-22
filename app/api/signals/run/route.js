export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) { return POST(req); }
export async function POST(req) {
  try {
    const base = new URL(req.url).origin;

    // 1) 체크(알림 생성)
    const r1 = await fetch(`${base}/api/signals/check`, { method: "POST", cache: "no-store" });
    const d1 = await r1.json().catch(() => ({}));

    // 2) 디스패치(텔레그램 발송)
    const r2 = await fetch(`${base}/api/signals/dispatch`, { method: "POST", cache: "no-store" });
    const d2 = await r2.json().catch(() => ({}));

    return new Response(JSON.stringify({ ok: true, check: d1, dispatch: d2 }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
