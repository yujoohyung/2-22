"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    // 필요한 로컬 상태 정리
    try {
      localStorage.removeItem("txHistory");
      localStorage.removeItem("rbHistory");
      // 필요하면 추가로 지우세요
    } catch {}

    // 홈으로 이동
    router.replace("/");
  }, [router]);

  return null; // 화면 렌더링 없이 즉시 리다이렉트
}
