// app/api/signals/dispatch/route.js
import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../../../../lib/telegram.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KST 표기용
function formatKST(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const y = k.getUTCFullYear();
  const m = p(k.getUTCMonth() + 1);
  const d = p(k.getUTCDate());
  const hh = p(k.getUTCHours());
  const mm = p(k.getUTCMinutes());
  return `${y}-${m}-${d} ${hh}시 ${mm}분`;
}

export async function POST() {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 1) 아직 안 보낸 알림 불러오기
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

    // 2) 수신 chat_id: settings 테이블 or ENV
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

    // 3) 메시지 구성 (단순 그룹핑)
    const kstNow = formatKST();
    const lines = [`${kstNow}`];
    for (const a of alerts) {
      lines.push(
        `${a.symbol} | RSI ${Number(a.rsi).toFixed(2)} | ${a.level}\n${a.message}`
      );
    }
    const text = lines.join("\n");

    // 4) 발송
    await sendTelegram(text, chatId);

    // 5) sent=true 마킹
    const ids = alerts.map((a) => a.id);
    const { error: ue } = await supa
      .from("alerts")
      .update({ sent: true })
      .in("id", ids);
    if (ue) throw ue;

    return new Response(JSON.stringify({ ok: true, sent: ids.length }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e.message || e) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
