export const runtime = "edge";

const MOCK = { NASDAQ2X: 11500, BIGTECH2X: 9800 };

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sym = (searchParams.get("symbol") || "").toUpperCase();
  // TODO: 실제 가격 소스 연동 (KIS, DB 등)
  const price = MOCK[sym] ?? null;
  if (!price) {
    return new Response(JSON.stringify({ ok:false, error:"symbol not found" }), {
      status: 404,
      headers: { "content-type":"application/json; charset=utf-8" }
    });
  }
  return new Response(JSON.stringify({ ok:true, price, asOf: new Date().toISOString() }), {
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}
