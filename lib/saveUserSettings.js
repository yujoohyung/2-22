// lib/saveUserSettings.js (새 파일로 두거나, 사용하는 컴포넌트 안에 넣어도 됩니다)
import { createClient } from "@supabase/supabase-js";

function supaBrowser() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** 사용자 설정 저장: { yearly_budget, nickname, notify_enabled } 중 필요한 것만 보내세요 */
export async function saveUserSettings(partial) {
  const supa = supaBrowser();

  // 1) 현재 로그인 세션에서 액세스 토큰 꺼내기
  const { data: { session } } = await supa.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("로그인이 필요합니다.");

  // 2) 토큰을 Authorization 헤더에 붙여서 API 호출
  const res = await fetch("/api/user-settings/me", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(partial),
    cache: "no-store",
  });

  // 3) 에러 처리(지금 뜨던 "저장 실패: 로그인이 필요합니다."가 401일 때 나타났던 것)
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `save failed (${res.status})`);
  }

  const json = await res.json().catch(() => ({}));
  if (json?.ok === false) throw new Error(json?.error || "save failed");
  return json;
}
