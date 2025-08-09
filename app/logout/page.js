"use client";
import { useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function LogoutPage() {
  useEffect(() => {
    supabase.auth.signOut().finally(() => window.location.assign("/login"));
  }, []);
  return <p style={{ padding: 24 }}>로그아웃 중...</p>;
}
