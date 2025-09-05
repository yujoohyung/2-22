// app/api/env/route.ts
export const runtime = 'nodejs';

export async function GET() {
  const safe = {
    // 민감값은 그대로 노출하지 않고 'set/unset'만 표기
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? 'set' : 'unset',
    TELEGRAM_CHAT_ID_BROADCAST: process.env.TELEGRAM_CHAT_ID_BROADCAST ? 'set' : 'unset',
    SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : 'unset',
    SUPABASE_SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE ? 'set' : 'unset',
    // 필요하면 추가
  };
  return Response.json({ ok: true, env: safe });
}
