// lib/saveUserSettings.js
import { supa } from "./supaClient";

/**
 * 사용자 설정 저장
 * - 가능하면 Authorization: Bearer <access_token> 헤더 포함
 * - 토큰이 없어도 호출은 진행(서버가 쿠키 경로로 인증)
 */
export async function saveUserSettings(payload = {}) {
  let token = null;
  try {
    const { data, error } = await supa.auth.getSession();
    if (error) throw error;
    token = data?.session?.access_token || null;
  } catch (_) {
    token = null;
  }

  const headers = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch("/api/user-settings/save", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `save failed (${res.status})`);
  }
  return json?.data ?? null;
}
