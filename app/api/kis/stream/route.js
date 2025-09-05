// app/api/kis/stream/route.js
// 폴링 기반 SSE: /api/kis/now?code=... 를 2초마다 조회해 tick 이벤트로 전달
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) return new Response("missing code", { status: 400 });

  const enc = new TextEncoder();

  // ✅ TDZ 방지: controller를 먼저 선언
  let controller;
  let closed = false;
  let pollTimer = null;
  let pingTimer = null;
  let last = { price: null, high: null };

  const send = (lines) => {
    if (closed || !controller) return;
    try {
      const payload = Array.isArray(lines)
        ? lines.join("\n") + "\n\n"
        : String(lines) + "\n\n";
      controller.enqueue(enc.encode(payload));
    } catch {
      // 이미 닫힌 상태면 모든 타이머 정리
      closed = true;
      try { clearInterval(pollTimer); } catch {}
      try { clearInterval(pingTimer); } catch {}
    }
  };

  const stream = new ReadableStream({
    start(c) {
      controller = c;

      // 재연결 지시
      send(`retry: 2000`);

      const poll = async () => {
        if (closed) return;
        try {
          const res = await fetch(
            `${origin}/api/kis/now?code=${encodeURIComponent(code)}`,
            { cache: "no-store" }
          );

          let body = {};
          try { body = await res.json(); } catch {}

          if (body?.ok) {
            const o = body.output || {};
            const price = Number(o.stck_prpr || 0);
            const high  = Number(o.stck_hgpr || 0);

            if (
              Number.isFinite(price) &&
              (price !== last.price || high !== last.high)
            ) {
              last = { price, high };
              send([
                `event: message`,
                `data: ${JSON.stringify({ type: "tick", code, price, high, ts: Date.now() })}`,
              ]);
            }
          } else {
            // 필요하면 디버그 이벤트 전송 가능
            // send([`event: debug`, `data: ${JSON.stringify(body)}`]);
          }
        } catch (e) {
          if (!closed) {
            send([
              `event: error`,
              `data: ${JSON.stringify(String(e?.message || e))}`,
            ]);
          }
        }
      };

      // 즉시 1회 + 2초마다 폴링
      pollTimer = setInterval(poll, 2000);
      poll();

      // 15초마다 heartbeat (중간 프록시 끊김 방지)
      pingTimer = setInterval(() => {
        if (!closed) send(`: ping`);
      }, 15000);
    },

    cancel() {
      closed = true;
      try { clearInterval(pollTimer); } catch {}
      try { clearInterval(pingTimer); } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
