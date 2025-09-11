// app/api/signals/run/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── 권한 체크 ──────────────────────────────────────────────────────────────
function isAuthorized(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  const url = new URL(req.url);
  const q = url.searchParams.get("secret");

  const secret = (process.env.CRON_SECRET || "").trim();

  console.log("[RUN] has env CRON_SECRET? ", secret ? "YES" : "NO");
  if (secret) console.log("[RUN] env head: ", secret.slice(0, 2) + "***");
  console.log("[RUN] auth header: ", header ? header.slice(0, 20) + "***" : "(none)");
  console.log("[RUN] query secret: ", q ? q.slice(0, 2) + "***" : "(none)");

  if (!secret) return false;
  if (token && token === secret) return true;
  if (q && q === secret) return true;
  return false;
}

export async function GET(req) { return POST(req); }

export async function POST(req) {
  try {
    // 1) 1차 권한 체크(헤더 or ?secret=)
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // 2) 내부 호출 준비: 반드시 "우리의 시크릿"을 실어 보낸다
    const secret = (process.env.CRON_SECRET || "").trim();
    const authHeader = `Bearer ${secret}`;

    // 배이스 URL: 가능하면 고정 프로덕션 도메인을 권장
    const base =
      process.env.NEXT_PUBLIC_SITE_URL ||            // ← 예: https://2xbuysell.vercel.app
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    console.log("[RUN] base =", base);

    async function hit(path) {
      const url = new URL(path, base);
      // (선택) 쿼리로도 넘기고 싶다면 아래 라인 주석 해제
      // url.searchParams.set("secret", secret);

      const r = await fetch(url, {
        method: "POST",
        headers: {
          // 중요한 부분: 내부 엔드포인트가 동일 검증을 쓴다면 시크릿을 여기로!
          Authorization: authHeader,
          "content-type": "application/json",
          "cache-control": "no-store",
        },
        // 필요한 바디가 있으면 body 넣기
      });

      let body = {};
      try { body = await r.json(); } catch (e) {
        console.warn("[RUN] non-JSON response from", String(url), "status=", r.status);
      }
      return { status: r.status, body };
    }

    // 3) 실제 호출
    const checkRes = await hit("/api/signals/check");
    const dispatchRes = await hit("/api/signals/dispatch");

    // 4) 결과 반환 (항상 JSON)
    return NextResponse.json({ ok: true, check: checkRes, dispatch: dispatchRes });
  } catch (e) {
    console.error("[RUN] error:", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
