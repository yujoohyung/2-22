// lib/saveUserSettings.js
import { supa } from "./supaClient";

/**
 * 사용자 설정 저장 (Authorization: Bearer <access_token> 포함)
 * @param {{ yearly_budget?: number }} payload
 * @returns {Promise<any>}
 */
export async function saveUserSettings(payload = {}) {
  const { data, error } = await supa.auth.getSession();
  if (error) throw new Error(error.message || "auth error");
  const token = data?.session?.access_token;
  if (!token) throw new Error("로그인이 필요합니다.");

  const res = await fetch("/api/user-settings/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `save failed (${res.status})`);
  }
  return json?.data ?? null;
}
