"use client";

import { useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export default function LoginPage() {
  const supabase = createClientComponentClient(); // ✅ 쿠키 동기화 클라
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    // 허용 이메일 서버에서 확인
    const res = await fetch("/api/is-allowed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() })
    });
    const { allowed } = await res.json();
    if (!res.ok || !allowed) {
      alert("허용되지 않은 계정입니다.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    if (error) {
      alert("아이디 또는 비밀번호가 올바르지 않습니다.");
      return;
    }

    // ✅ 쿠키 세션이 미들웨어에 반영되도록 하드 리다이렉트
    const params = new URLSearchParams(window.location.search);
    const back = params.get("redirectTo") || "/dashboard";
    window.location.assign(back);
  };

  return (
    <div style={{ padding: 50, maxWidth: 400, margin: "100px auto", border: "1px solid #ddd", borderRadius: 8 }}>
      <h1 style={{ textAlign: "center", marginBottom: 30 }}>로그인</h1>
      <input type="email" placeholder="이메일" value={email} onChange={(e)=>setEmail(e.target.value)}
             style={{ width:"100%", padding:10, marginBottom:10 }} />
      <input type="password" placeholder="비밀번호" value={password} onChange={(e)=>setPassword(e.target.value)}
             style={{ width:"100%", padding:10, marginBottom:20 }} />
      <button onClick={handleLogin} style={{ width:"100%", padding:12, background:"#007bff", color:"#fff", border:"none", borderRadius:4 }}>
        로그인
      </button>
      <p style={{ marginTop: 20, textAlign: "center" }}>
        계정이 없으신가요? <a href="/admin/add-user">회원가입</a>
      </p>
    </div>
  );
}
