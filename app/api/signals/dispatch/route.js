// app/api/signals/dispatch/route.js
import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../../../../lib/telegram.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ──────────────────────────────────────────────────────────────
   유틸
────────────────────────────────────────────────────────────── */
function formatKST(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}시 ${p(k.getUTCMinutes())}분`;
}

// (선택) Vercel Cron 보호: 환경변수 CRON_SECRET 있으면 GET 요청의 Authorization 검사
function guardCronGET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}` ? null : new Response("Unauthorized", { status: 401 });
}

/* ──────────────────────────────────────────────────────────────
   Vercel Cron은 GET만 호출 → GET에서 POST 로직 재사용
────────────────────────────────────────────────────────────── */
export async function GET(req) {
  const g = guardCronGET(req);
  if (g) return g;
  return POST(req);
}

/* ──────────────────────────────────────────────────────────────
   핵심: 미발송 alerts를 텔레그램으로 보내고 sent=true로 마킹
────────────────────────────────────────────────────────────── */
export async function POST() {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 1) 아직 안 보낸 알림
    const { data: alerts, error: ae } = await supa
      .from("alerts")
      .select("*")
      .eq("sent", false)
      .order("created_at", { ascending: true });

    if (ae) throw ae;

    if (!alerts?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // 2) 수신 chat_id (ENV 우선 → settings.telegram_chat_id 백업)
    let chatId = process.env.TELEGRAM_CHAT_ID_BROADCAST || null;
    if (!chatId) {
      const { data: sets } = await supa
        .from("settings")
        .select("telegram_chat_id")
        .limit(1)
        .maybeSingle();
      chatId = sets?.telegram_chat_id ?? null;
    }
    if (!chatId) throw new Error("telegram chat_id not configured");

    // 3) 메시지 조립 (간단 그룹핑)
    const kstNow = formatKST();
    const lines = [`${kstNow}`];
    for (const a of alerts) {
      const rsi = Number(a.rsi);
      const head = `${a.symbol} | RSI ${Number.isFinite(rsi) ? rsi.toFixed(2) : "-" } | ${a.level}`;
      // a.message 안에 “약 N주 (예산 …)” 등 상세가 이미 들어있음
      lines.push(`${head}\n${a.message}`);
    }
    const text = lines.join("\n");

    // 4) 발송
    await sendTelegram(text, chatId);

    // 5) sent=true 마킹
    const ids = alerts.map((a) => a.id);
    const { error: ue } = await supa.from("alerts").update({ sent: true }).in("id", ids);
    if (ue) throw ue;

    return new Response(JSON.stringify({ ok: true, sent: ids.length }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
