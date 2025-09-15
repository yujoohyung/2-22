// lib/saveUserSettings.js
import { supa } from "./supaClient";

/** Supabase 프로젝트 ref 추출 (https://xxxx.supabase.co → xxxx) */
function getProjectRef() {
  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const m = url.match(/^https:\/\/([^.]+)\.supabase\.co\/?$/i);
    return m ? m[1] : null;
  } catch { return null; }
}

/** localStorage에서 액세스 토큰 읽기 (세션 훅 실패 대비) */
function getTokenFromLocalStorage() {
  try {
    const ref = getProjectRef();
    if (!ref) return null;
    const key = `sb-${ref}-auth-token`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj?.access_token || obj?.currentSession?.access_token || null;
  } catch { return null; }
}

/** 사용자 설정 저장: 가능하면 Authorization 헤더도 함께 전송 */
export async function saveUserSettings(payload = {}) {
  let token = null;

  // A) 정석: supabase-js에서 세션 토큰 얻기
  try {
    const { data, error } = await supa.auth.getSession();
    if (error) throw error;
    token = data?.session?.access_token || null;
  } catch {}

  // B) 보강: localStorage에서 직접 토큰 꺼내기
  if (!token && typeof window !== "undefined") {
    token = getTokenFromLocalStorage();
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
