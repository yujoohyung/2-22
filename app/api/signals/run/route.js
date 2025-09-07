export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function check() {
  // 기존 check 로직 (함수로 분리해 두면 좋음)
}
async function dispatch() {
  // 기존 dispatch 로직
}

export async function GET() {
  await check();
  await dispatch();
  return Response.json({ ok: true });
}
