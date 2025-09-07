// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname, search } = req.nextUrl;

  // 1) 항상 공개(미들웨어 우회)
  //    - 정적/이미지/Next 내부 경로
  //    - 모든 API (크론/텔레그램 훅 등 비로그인 호출 필요 시 편하게 전체 허용)
  //      보안을 더 엄격히 하려면 '/api/' 전체 대신 개별 경로만 추가하세요.
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/assets/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/api/")
  ) {
    return res;
  }

  // 2) 인증 페이지(반로그인 영역): 로그인/회원가입/로그아웃/환경 테스트 등
  //    - 비로그인: 통과
  //    - 로그인: /dashboard로 리다이렉트
  const AUTH_PAGES = ["/login", "/signup", "/logout", "/env-test"];
  const isAuthPage = AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // Supabase 세션 조회 (표준: URL/KEY 없이)
  const supabase = createMiddlewareClient({ req, res });

  let isLoggedIn = false;
  try {
    const { data } = await supabase.auth.getUser();
    isLoggedIn = !!data.user;
  } catch {
    isLoggedIn = false;
  }

  if (isAuthPage) {
    if (isLoggedIn) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    return res; // 비로그인 사용자는 로그인/회원가입 페이지로 통과
  }

  // 3) 그 외 모든 경로는 로그인 필수
  if (!isLoggedIn) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname + (search || ""));
    return NextResponse.redirect(url);
  }

  return res;
}

// 전 경로 대상(정적/이미지 제외)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
