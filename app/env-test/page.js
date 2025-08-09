import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE;
  const alpha = process.env.ALPHA_VANTAGE_KEY;

  let dbTest = "❌ 실패";
  let dbError = null;

  if (serviceRole && supabaseUrl) {
    try {
      const admin = createClient(supabaseUrl, serviceRole);
      const { error } = await admin.from("allowed_emails").select("id").limit(1);
      dbTest = error ? "❌ 오류" : "✅ 연결 성공";
      dbError = error?.message || null;
    } catch (e) {
      dbTest = "❌ 예외";
      dbError = e.message;
    }
  } else {
    dbError = "환경변수 누락: SUPABASE_SERVICE_ROLE 또는 NEXT_PUBLIC_SUPABASE_URL";
  }

  return new Response(
    JSON.stringify({
      SUPABASE_SERVICE_ROLE: !!serviceRole ? "✅ 로드됨" : "❌ 없음",
      ALPHA_VANTAGE_KEY: !!alpha ? "✅ 로드됨" : "❌ 없음",
      DB_CONNECTION: dbTest,
      DB_ERROR: dbError,
    }),
    { status: 200 }
  );
}
