export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { GET as _ } from "../1030/route"; // 같은 로직 재사용

export async function GET(req) {
  // 14:30 표시만 다르게
  const r = await _.call(null, req);
  return Response.json({ ok: true, when: "14:30 KST" });
}
