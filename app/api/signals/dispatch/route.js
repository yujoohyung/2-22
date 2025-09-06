// app/api/signals/dispatch/route.js
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KST 포맷  "YYYY-MM-DD HH시 mm분"
function kstNowText(d = new Date()) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${dd} ${hh}시 ${mm}분`;
}

async function sendTelegram(text) {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID_BROADCAST;
  if (!bot || !chat) throw new Error("TELEGRAM env missing");

  const url = `https://api.telegram.org/bot${bot}/sendMessage`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error("telegram send failed: " + t);
  }
}

/**
 * 미발송(alerts.sent = false) 항목을 읽어서
 * 텔레그램으로 전송 후 sent=true로 업데이트
 */
export async function POST() {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 아직 안 보낸 알림 수집
    const { data: rows, error } = await supa
      .from("alerts")
      .select("id, symbol, rsi, level, message, created_at, sent")
      .eq("sent", false)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return Response.json({ ok: true, sent: 0 });
    }

    // 간단 집계: 같은 시간대라도 일괄 묶어 한 번에 보냄
    const header = kstNowText();
    const body = rows.map(r => r.message || `${r.symbol} / ${r.level}`).join("\n");
    const text = `${header}\n${body}`;

    await sendTelegram(text);

    // 전송 완료 표시
    const ids = rows.map(r => r.id);
    const { error: upErr } = await supa.from("alerts").update({ sent: true }).in("id", ids);
    if (upErr) throw upErr;

    return Response.json({ ok: true, sent: rows.length });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e.message || e) }),
      { status: 500 }
    );
  }
}

// ✅ GET은 내보내지 않습니다. (중복 선언 방지)
// 필요하면 크론 래퍼에서 POST로 이 엔드포인트를 호출하세요.
