// app/api/kis/stream/route.js
import { getKisToken } from "../../../../lib/kis.server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) return new Response("missing code", { status: 400 });

  const enc = new TextEncoder();

  // KIS 현재가 한 번 조회
  async function fetchNowOnce() {
    const token = await getKisToken();
    const url = `${process.env.KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price` +
      `?fid_cond_mrkt_div_code=J&fid_input_iscd=${encodeURIComponent(code)}`;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        "authorization": `Bearer ${token}`,
        "appkey": process.env.KIS_APP_KEY,
        "appsecret": process.env.KIS_APP_SECRET,
        "tr_id": process.env.KIS_TR_PRICE || "FHKST01010100",
        "custtype": "P",
      },
      cache: "no-store",
    });

    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { j = null; }

    if (!r.ok) {
      // 서버로 에러 메시지 넘김
      const msg = j?.error_code ? `${j.error_code} ${j.error_description || ""}`.trim() : txt;
      throw new Error(msg || `HTTP ${r.status}`);
    }

    const o = j?.output || j?.output1 || {};
    const price = Number(o.stck_prpr || 0);
    const high  = Number(o.stck_hgpr || 0);
    return { price, high };
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let timer = null;

      const safeSend = (line) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(line)); } catch { /* ignore */ }
      };

      // SSE 권장 헤더/지시어
      safeSend(`retry: 2000\n\n`);

      // 즉시 1번 보내기(대시보드가 바로 갱신되도록)
      fetchNowOnce()
        .then(({ price, high }) => {
          safeSend(`data: ${JSON.stringify({ type: "tick", price, high })}\n\n`);
        })
        .catch((e) => {
          safeSend(`event: error\ndata: ${JSON.stringify(String(e?.message || e))}\n\n`);
        });

      // 3초마다 폴링 → tick 전송
      timer = setInterval(async () => {
        try {
          const { price, high } = await fetchNowOnce();
          safeSend(`data: ${JSON.stringify({ type: "tick", price, high })}\n\n`);
        } catch (e) {
          // 스트림이 살아있으면 에러 이벤트로만 알리고, 스트림은 유지
          safeSend(`event: error\ndata: ${JSON.stringify(String(e?.message || e))}\n\n`);
        }
      }, 3000);

      // 15초마다 keep-alive 주석(일부 프록시 타임아웃 방지)
      const ka = setInterval(() => {
        safeSend(`: ping\n\n`);
      }, 15000);

      // 종료/취소 처리
      const closeAll = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        if (ka) clearInterval(ka);
        try { controller.close(); } catch {}
      };

      // 브라우저에서 연결 끊으면 cancel 호출됨
      // (Next.js Edge/Node 런타임마다 호출 타이밍이 달라서 두 군데서 모두 방어)
      // eslint-disable-next-line no-unused-vars
      this.cancel = () => closeAll();

      // 혹시 런타임에서 'aborted' 신호를 받을 경우 대비
      try {
        const signal = req.signal;
        if (signal && typeof signal.addEventListener === "function") {
          signal.addEventListener("abort", closeAll);
        }
      } catch {}

    },
    cancel() { /* handled above */ },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      // Vercel/프록시가 압축하지 않게
      "x-no-compression": "1",
    },
  });
}
