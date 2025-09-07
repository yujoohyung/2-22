"use client";

import { useState } from "react";

export default function SignupPage() {
  const [adminCode, setAdminCode] = useState("");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");

  const handleSignup = async () => {
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminCode, email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || "회원가입 실패");
        return;
      }
      alert("회원가입 완료! 로그인 페이지로 이동합니다.");
      window.location.assign("/login");
    } catch (e) {
      alert("네트워크 오류");
    }
  };

  return (
    <div style={{ padding: 50, maxWidth: 420, margin: "100px auto", border: "1px solid #ddd", borderRadius: 8 }}>
      <h1 style={{ textAlign: "center", marginBottom: 30 }}>회원가입</h1>

      <label style={{ display:"block", fontSize:12, color:"#666", marginBottom:6 }}>관리자 코드</label>
      <input
        type="password"
        placeholder="관리자 코드"
        value={adminCode}
        onChange={(e)=>setAdminCode(e.target.value)}
        style={{ width:"100%", padding:10, marginBottom:12 }}
      />

      <label style={{ display:"block", fontSize:12, color:"#666", marginBottom:6 }}>이메일</label>
      <input
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e)=>setEmail(e.target.value)}
        style={{ width:"100%", padding:10, marginBottom:12 }}
      />

      <label style={{ display:"block", fontSize:12, color:"#666", marginBottom:6 }}>비밀번호</label>
      <input
        type="password"
        placeholder="비밀번호"
        value={password}
        onChange={(e)=>setPassword(e.target.value)}
        style={{ width:"100%", padding:10, marginBottom:20 }}
      />

      <button
        onClick={handleSignup}
        style={{ width:"100%", padding:12, background:"#10b981", color:"#fff", border:"none", borderRadius:4, fontWeight:700 }}
      >
        가입하기
      </button>

      <p style={{ marginTop: 16, textAlign: "center" }}>
        이미 계정이 있으신가요? <a href="/login">로그인</a>
      </p>
    </div>
  );
}
