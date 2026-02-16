import { getBrowserClient } from "@/lib/supaClient";

export async function saveUserSettings(settings) {
  // [수정] supa 변수 대신 함수로 클라이언트 가져오기
  const supa = getBrowserClient();
  
  const { data: { session } } = await supa.auth.getSession();
  if (!session) throw new Error("Not logged in");

  const { error } = await supa
    .from("user_settings")
    .upsert({ 
      user_id: session.user.id, 
      ...settings,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });

  if (error) throw error;
  return true;
}