// /lib/auth-server.js
import { cookies as nextCookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

/* ===============================
   내부 유틸: 환경값 정리/검증
================================ */
// /lib/auth-server.js 중 일부만 발췌
function getSupabaseUrl() {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!raw) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(raw)) {
    throw new Error("Bad NEXT_PUBLIC_SUPABASE_URL");
  }
  return raw.replace(/\/$/, "");
}

function getAnonKey() {
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!anon) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return anon;
}

function getServiceKey() {
  const key = (process.env.SUPABASE_SERVICE_ROLE || "").trim();
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE");
  return key;
}

/* ===============================
   서버 전용: 쿠키 기반 클라이언트
   - auth-helpers가 쿠키 세션을 읽어
     DB 요청에 JWT를 자동 전파
================================ */
export function getRouteClient() {
  // 서버에서만 사용
  if (typeof window !== "undefined") {
    throw new Error("getRouteClient() must be called on server only");
  }
  return createRouteHandlerClient({ cookies: nextCookies });
}

/** 쿠키(세션)에서 현재 로그인 유저 가져오기 */
export async function getUserServer() {
  const supa = getRouteClient();
  const { data, error } = await supa.auth.getUser();
  if (error) throw error;
  return { user: data?.user ?? null, supa };
}

/* ===============================
   서버 전용: 헤더 기반(JWT) 클라이언트
   - Authorization: Bearer <token> 우선 사용
   - DB 요청에도 JWT가 전파되도록 global headers 설정
================================ */
export function createDbClientWithJwt(token) {
  if (!token) throw new Error("JWT token required");
  const url = getSupabaseUrl();
  const anon = getAnonKey();
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Authorization 헤더로 유저 확인 (없으면 null) */
export async function getUserFromAuthHeader(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { user: null, supa: null, token: null };

  const url = getSupabaseUrl();
  const anon = getAnonKey();

  // 토큰 검증용(가벼운) 클라이언트
  const supaAuth = createClient(url, anon);
  const { data: userRes, error } = await supaAuth.auth.getUser(token);
  if (error || !userRes?.user) {
    return { user: null, supa: null, token };
  }

  // DB 작업용: JWT 전파 클라이언트
  const supa = createDbClientWithJwt(token);
  return { user: userRes.user, supa, token };
}

/* ===============================
   공용 가드: 유저 필수
   - 1) 헤더(Bearer) 우선
   - 2) 없으면 쿠키 기반 시도
================================ */
export async function requireUser(req) {
  // 1) 헤더 우선
  const viaHeader = await getUserFromAuthHeader(req);
  if (viaHeader?.user && viaHeader?.supa) return viaHeader;

  // 2) 쿠키 세션
  const viaCookie = await getUserServer().catch(() => null);
  if (viaCookie?.user && viaCookie?.supa) return { ...viaCookie, token: null };

  throw new Error("unauthorized");
}

/* ===============================
   서비스 롤 (서버 전용) — RLS 우회 주의
================================ */
export function getServiceClient() {
  if (typeof window !== "undefined") {
    throw new Error("getServiceClient() must be called on server only");
  }
  const url = getSupabaseUrl();
  const key = getServiceKey();
  return createClient(url, key);
}
