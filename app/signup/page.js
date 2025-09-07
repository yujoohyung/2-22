"use client";

import { useState } from "react";

export default function SignupPage() {
  const [adminCode, setAdminCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!adminCode || !email || !password) {
      alert("관리자 코드 / 이메일 / 비밀번호를 모두 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminCode, email: email.trim(), password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "회원가입 실패");

      alert("가입 완료! 이제 로그인해 주세요.");
      window.location.assign("/login");
    } catch (e) {
      alert(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 420, margin: "80px auto",
      border: "1px solid #ddd", borderRadius: 12, background: "#fff" }}>
      <h1 style={{ textAlign: "center", marginBottom: 20 }}>회원가입</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          type="password"
          placeholder="관리자 코드"
          value={adminCode}
          onChange={(e) => setAdminCode(e.target.value)}
          style={ipt}
          autoComplete="off"
        />
        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={ipt}
          autoComplete="off"
        />
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={ipt}
          autoComplete="new-password"
        />
        <button
          type="submit"
          disabled={busy}
          style={{ ...btn, background: "#111827", color: "#fff" }}
        >
          {busy ? "처리 중..." : "가입하기"}
        </button>
        <a href="/login" style={{ textAlign: "center", marginTop: 6 }}>
          이미 계정이 있으신가요? 로그인
        </a>
      </form>
    </div>
  );
}

const ipt = { width: "100%", padding: "12px 14px", border: "1px solid #ddd", borderRadius: 10, fontSize: 14 };
const btn = { width: "100%", padding: "12px 14px", border: "1px solid #111827", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" };
