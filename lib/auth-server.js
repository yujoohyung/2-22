// /lib/auth-server.js
import { cookies as nextCookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

/** 쿠키(세션) 기반 Supabase 클라이언트 (App Router용) */
export function getRouteClient() {
  return createRouteHandlerClient({ cookies: nextCookies });
}

/** 쿠키(세션)에서 현재 로그인 유저 가져오기 */
export async function getUserServer() {
  const supa = getRouteClient();
  const { data: { user }, error } = await supa.auth.getUser();
  if (error) throw error;
  return { user, supa };
}

/** Service Role 클라이언트 (서버에서만 사용) */
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("SUPABASE env missing");
  return createClient(url, key);
}

/** Authorization: Bearer <token> 헤더로 유저 확인 (필요 시 사용) */
export async function getUserFromAuthHeader(req) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/Bearer\s+(.+)/i);
  if (!m) return { user: null, supa: null };

  const token = m[1].trim();
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error } = await supa.auth.getUser();
  if (error) throw error;
  return { user, supa };
}
