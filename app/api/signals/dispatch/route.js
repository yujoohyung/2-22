import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "../../../../lib/telegram.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 4096 제한 여유분(헤더/포맷 포함) 감안해 3800자로 쪼갭니다.
const TG_CHUNK = 3800;

function formatKST(ts = new Date()) {
  const k = new Date(ts.getTime() + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth()+1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

function chunkText(text, size = TG_CHUNK) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

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
        status: 200, headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // 2) chat_id
    let chatId = process.env.TELEGRAM_CHAT_ID_BROADCAST || null;
    if (!chatId) {
      const { data: sets } = await supa
        .from("settings").select("telegram_chat_id").limit(1).maybeSingle();
      chatId = sets?.telegram_chat_id || null;
    }
    if (!chatId) throw new Error("telegram chat_id not configured");

    // 3) 메시지 빌드 + 분할 발송
    const kstNow = formatKST();
    const header = `[알림] ${kstNow}`;
    const body = alerts.map(a => a.message).join("\n\n");
    const allText = `${header}\n\n${body}`;
    const parts = chunkText(allText);

    for (const [i, part] of parts.entries()) {
      const prefix = parts.length > 1 ? `(${i+1}/${parts.length})\n` : "";
      await sendTelegram(prefix + part, chatId);
    }

    // 4) sent=true 마킹
    const ids = alerts.map(a => a.id);
    const { error: ue } = await supa.from("alerts").update({ sent: true }).in("id", ids);
    if (ue) throw ue;

    return new Response(JSON.stringify({ ok: true, sent: ids.length }), {
      status: 200, headers: { "content-type": "application/json; charset=utf-8" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
      status: 500, headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
