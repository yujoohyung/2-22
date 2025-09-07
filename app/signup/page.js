"use client";

import { useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export default function SignUpPage() {
  const supabase = createClientComponentClient();
  const [adminCode, setAdminCode] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState("");

  const onSubmit = async () => {
    setErr("");
    if (!adminCode.trim() || !email.trim() || !password) {
      setErr("모든 항목을 입력하세요.");
      return;
    }
    setLoading(true);
    try {
      // 서버 API로 위임(관리자 코드 검증 + 회원 생성)
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminCode: adminCode.trim(),
          email: email.trim(),
          password,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "회원가입 실패");
      }

      alert("회원가입이 완료되었습니다. 이제 로그인 해주세요.");
      window.location.assign("/login");
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={pageWrap}>
      <div style={card}>
        <h1 style={title}>회원가입</h1>

        <input
          type="text"
          placeholder="관리자 코드"
          value={adminCode}
          onChange={(e) => setAdminCode(e.target.value)}
          style={inputBase}
          autoComplete="off"
        />
        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputBase}
          autoComplete="email"
        />
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputBase}
          autoComplete="new-password"
        />

        {err && <div style={errorBox}>{err}</div>}

        <button onClick={onSubmit} style={primaryBtn} disabled={loading}>
          {loading ? "처리 중..." : "가입하기"}
        </button>

        <p style={helper}>
          이미 계정이 있으신가요?{" "}
          <a href="/login" style={link}>로그인</a>
        </p>
      </div>
    </div>
  );
}

/* ---------- styles ---------- */
const pageWrap = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#fafafa",
  padding: 16,
};

const card = {
  width: "100%",
  maxWidth: 420,
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  boxShadow: "0 6px 16px rgba(0,0,0,0.06)",
  padding: 24,
};

const title = {
  textAlign: "center",
  margin: "8px 0 20px",
  fontSize: 24,
  fontWeight: 800,
};

const inputBase = {
  width: "100%",
  height: 44,               // ✅ 동일 높이
  padding: "10px 12px",
  marginBottom: 10,         // ✅ 동일 간격
  border: "1px solid #d1d5db",
  borderRadius: 10,
  outline: "none",
  fontSize: 14,
  boxSizing: "border-box",  // ✅ 패딩/테두리 포함해도 폭 100%
};

const primaryBtn = {
  width: "100%",
  height: 44,               // ✅ 버튼도 동일 높이
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
  marginTop: 6,
};

const helper = {
  textAlign: "center",
  marginTop: 14,
  color: "#6b7280",
  fontSize: 13,
};

const link = { color: "#111827", fontWeight: 700, textDecoration: "none" };

const errorBox = {
  width: "100%",
  padding: "10px 12px",
  margin: "6px 0 8px",
  background: "#fff1f2",
  color: "#b91c1c",
  border: "1px solid #fecdd3",
  borderRadius: 10,
  fontSize: 13,
};
