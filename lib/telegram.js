// lib/telegram.js
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT = process.env.TELEGRAM_CHAT_ID_BROADCAST;

/** 텔레그램 텍스트 전송 (기본: 브로드캐스트 채널/그룹) */
export async function sendTelegram(text, chatId = DEFAULT_CHAT) {
  if (!BOT) throw new Error("TELEGRAM_BOT_TOKEN env missing");
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID_BROADCAST env missing");

  const res = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`telegram send failed ${res.status} ${t}`);
  }
  return res.json().catch(() => ({}));
}
