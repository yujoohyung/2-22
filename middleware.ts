// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname, search } = req.nextUrl;

  // 공개 경로(여기만 로그인 없이 통과)
  const PUBLIC = ["/login", "/logout", "/env-test", "/favicon.ico"];
  const isPublic =
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/assets/") ||
    PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (isPublic) return res;

  // ✅ 표준 시그니처: URL/KEY 넣지 않음
  const supabase = createMiddlewareClient({ req, res });

  // 로그인 여부 확인
  let isLoggedIn = false;
  try {
    const { data } = await supabase.auth.getUser();
    isLoggedIn = !!data.user;
  } catch {
    isLoggedIn = false;
  }

  // 비공개 경로는 전부 로그인 필요
  if (!isLoggedIn) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname + (search || ""));
    return NextResponse.redirect(url);
  }

  // 로그인 상태에서 /login 접근 → /dashboard
  if (pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return res;
}

// 전 경로 대상(정적/이미지 제외)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
