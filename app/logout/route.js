import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export async function GET(req) {
  const supabase = createRouteHandlerClient({ cookies });
  // 서버에서 세션 쿠키 제거
  await supabase.auth.signOut();

  // 로그인 페이지로 리다이렉트
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}
