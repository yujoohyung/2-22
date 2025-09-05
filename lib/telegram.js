export async function sendTelegram(text, chatId = process.env.TELEGRAM_CHAT_ID_BROADCAST) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) throw new Error("TELEGRAM env missing");
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status} ${await res.text()}`);
  return res.json();
}
