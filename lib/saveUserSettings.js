"use client";

import { supa } from "@/lib/supaClient";

/** Supabase 프로젝트 ref 추출 (https://xxxx.supabase.co → xxxx) */
function getProjectRef() {
  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const m = url.match(/^https:\/\/([^.]+)\.supabase\.co\/?$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** localStorage에서 액세스 토큰 읽기 (세션 훅 실패 대비) */
function getTokenFromLocalStorage() {
  try {
    const ref = getProjectRef();
    if (!ref || typeof window === "undefined") return null;
    const key = `sb-${ref}-auth-token`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const obj = JSON.parse(raw);
    // supabase-js v2 일반 포맷
    if (obj?.access_token) return obj.access_token;
    if (obj?.currentSession?.access_token) return obj.currentSession.access_token;
    // 혹시 배열 형태가 들어오는 경우(예방)
    if (Array.isArray(obj) && typeof obj[0] === "string") return obj[0];

    return null;
  } catch {
    return null;
  }
}

/** 사용자 설정 저장: 가능하면 Authorization 헤더도 함께 전송 */
export async function saveUserSettings(payload = {}) {
  // A) 정석: supabase-js에서 세션 토큰 얻기
  let token = null;
  try {
    const { data } = await supa.auth.getSession();
    token = data?.session?.access_token || null;
  } catch {
    // no-op
  }

  // B) 보강: localStorage에서 직접 토큰 꺼내기
  if (!token) token = getTokenFromLocalStorage();

  const headers = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch("/api/user-settings/save", {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  // 응답 파싱
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }

  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `save failed (${res.status})`);
  }

  // 라우트 응답 형태가 { ok:true, via:"rpc", data?: ... } 같으니 그대로 반환
  return json;
}
