// app/api/signals/run/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 내부 API 호출 유틸 */
async function callJSON(url, { method = "POST", timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const headers = { "content-type": "application/json" };
    // (옵션) CRON_SECRET 있으면 Authorization로 전달
    if (process.env.CRON_SECRET) {
      headers.Authorization = `Bearer ${process.env.CRON_SECRET}`;
    }
    const res = await fetch(url, { method, headers, cache: "no-store", signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* noop */ }

    if (!res.ok) {
      return { ok: false, status: res.status, error: text || "request failed" };
    }
    return data ?? { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(to);
  }
}

/** 베이스 URL 결정: ENV → NEXT_PUBLIC_SITE_URL → 요청 origin → 로컬 */
function resolveBaseURL(req) {
  // 꼭 슬래시 없이 넣기(예: https://2xbuysell.vercel.app)
  if (process.env.CRON_BASE_URL) return process.env.CRON_BASE_URL;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  try { return new URL(req.url).origin; } catch { /* noop */ }
  return "http://localhost:3000";
}

export async function GET(req) { return POST(req); }

export async function POST(req) {
  const base = resolveBaseURL(req);

  // 1) 매수 신호 생성 (알맞은 시간대가 아니면 skip)
  const check = await callJSON(`${base}/api/signals/check`, { method: "POST" });

  // 2) 텔레그램 발송(개인별 바스켓/예산 반영 + 전역 alerts sent=true 마킹)
  const dispatch = await callJSON(`${base}/api/signals/dispatch`, { method: "POST" });

  const ok = (check?.ok !== false) && (dispatch?.ok !== false);
  const body = { ok, base, check, dispatch };

  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 207, // multi-status 느낌으로
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
