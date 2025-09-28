// lib/supaClient.js
"use client";
import { createClient } from "@supabase/supabase-js";

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

if (!URL || !/^https:\/\/.+\.supabase\.co$/.test(URL)) {
  throw new Error("Bad NEXT_PUBLIC_SUPABASE_URL");
}
if (!ANON) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

// 전역(브라우저 탭) 단일 캐시
function _getOrCreate() {
  if (typeof window === "undefined") {
    // 서버에서 잘못 import해도 '접근'하기 전엔 안 터지게만 두고,
    // 실제 접근하면 에러로 막아줌.
    throw new Error("Supabase browser client used on server");
  }
  const g = globalThis;
  if (!g.__SB_CLIENT__) {
    g.__SB_CLIENT__ = createClient(URL, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // (선택) storageKey를 명시하면 의도치 않은 키 충돌을 예방
        storageKey: `sb-${URL.match(/^https:\/\/([^.]*)/)[1]}-auth-token`,
      },
    });
    if (process.env.NODE_ENV !== "production") {
      console.log("[supabase] client created (once)");
    }
  }
  return g.__SB_CLIENT__;
}

/**
 * ✅ 호환 내보내기: 기존 코드 그대로
 *   import { supa } from "@/lib/supaClient"
 * 를 유지해도, supa의 프로퍼티에 '처음 접근'하는 순간에만
 * 실제 클라이언트를 생성하도록 Proxy를 사용.
 */
export const supa = new Proxy(
  {},
  {
    get(_t, prop) {
      const c = _getOrCreate();
      // 예: supa.auth, supa.from 등
      return Reflect.get(c, prop);
    },
    // 혹시 함수로 호출하려는 코드가 있어도 방어
    apply(_t, thisArg, args) {
      const c = _getOrCreate();
      return Reflect.apply(c, thisArg, args);
    },
  }
);

/**
 * ⚙️ 새 코드에서 쓰기 좋은 형태(원한다면 점진 도입)
 *   import { getBrowserClient } from "@/lib/supaClient"
 *   const sb = getBrowserClient()
 */
export function getBrowserClient() {
  return _getOrCreate();
}

// ❌ 기존 onAuthStateChange를 여기서 등록해두면
//    'import 순간'에 부수효과가 생겨 두 번째 인스턴스가 유발될 수 있음.
//    필요하면 별도의 훅 파일로 분리해서 최상위 client layout에서 1회만 구독하세요.
