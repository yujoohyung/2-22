import { NextResponse, type NextRequest } from 'next/server';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname, search } = req.nextUrl;

  // ✅ 공개 경로
  const PUBLIC = ['/login', '/admin/add-user', '/env-test', '/logout'];
  if (
    PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/')) ||
    pathname.startsWith('/api/')
  ) {
    return res;
  }

  const supabase = createMiddlewareClient({ req, res });
  const { data: { session } } = await supabase.auth.getSession();

  const protectedPaths = ['/dashboard', '/stocks', '/my', '/alerts', '/watchlist'];
  const isProtected = pathname.startsWith('/admin') || protectedPaths.includes(pathname);

  if (isProtected && !session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', pathname + search);
    return NextResponse.redirect(url);
  }

  // 로그인 상태에서 /login 접근 → 대시보드로
  if (pathname === '/login' && session) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    '/', '/login',
    '/dashboard', '/stocks', '/my', '/alerts', '/watchlist',
    '/admin', '/admin/:path*',
  ],
};
