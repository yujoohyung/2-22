export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function base() {
  if (process.env.CRON_BASE_URL) return process.env.CRON_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function runAll(reason) {
  const b = base();
  const h = { "content-type": "application/json" };

  // 1) 신호 계산/저장
  await fetch(`${b}/api/signals/check`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ reason }),
    // 내부 호출이므로 캐시 금지
    cache: "no-store",
  }).catch(() => null);

  // 2) 텔레그램 발송
  await fetch(`${b}/api/signals/dispatch`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ reason }),
    cache: "no-store",
  }).catch(() => null);
}

export async function GET(req) {
  // (선택) 간단한 시크릿 검증
  const ok = !process.env.CRON_SECRET ||
             req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
  if (!ok) return new Response("forbidden", { status: 403 });

  await runAll("cron-1030");
  return Response.json({ ok: true, when: "10:30 KST" });
}
