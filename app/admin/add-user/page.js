"use client";

import { useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export default function AddUserPage() {
  const supabase = createClientComponentClient();

  const [adminSecret, setAdminSecret] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const hardGo = (p) => window.location.assign(p);

  const handleAddUser = async () => {
    if (!adminSecret) return alert("관리자 코드를 입력하세요.");
    if (!email || !password) return alert("이메일/비밀번호를 입력하세요.");

    setLoading(true);
    try {
      const res = await fetch("/api/admin-create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
         email: email.trim(),
         password,
         adminSecret: adminSecret.trim(),
}),

      });
        
      const data = await res.json();

      // 관리자 코드 틀림
      if (res.status === 401 || data?.error === "invalid-admin-code") {
        alert("관리자 코드가 올바르지 않습니다.");
        return;
      }

      // 이미 있는 계정이면 바로 로그인 시도
      const already =
        !res.ok && typeof data.error === "string" &&
        data.error.toLowerCase().includes("already");
      if (!res.ok && !already) {
        alert("❌ 계정 생성 실패: " + (data.error || "알 수 없는 오류"));
        return;
      }

      // 자동 로그인
      const { error: signinError } = await supabase.auth.signInWithPassword({ email, password });
      if (signinError) {
        alert("계정은 있지만 비밀번호가 달라요. 로그인 페이지로 이동합니다.");
        hardGo("/login");
        return;
      }

      alert("✅ 가입 및 자동 로그인 완료!");
      hardGo("/dashboard");
    } catch (e) {
      alert("❌ 오류: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 50, maxWidth: 420, margin: "100px auto", border: "1px solid #ddd", borderRadius: 8 }}>
      <h1 style={{ textAlign: "center", marginBottom: 30 }}>관리자 전용 회원가입</h1>

      {/* 관리자코드 입력칸 유지 */}
      <input
        type="password"
        placeholder="관리자 코드"
        value={adminSecret}
        onChange={(e) => setAdminSecret(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
      />
      <input
        type="email"
        placeholder="이메일"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
      />
      <input
        type="password"
        placeholder="비밀번호"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 20 }}
      />

      <button
        onClick={handleAddUser}
        disabled={loading}
        style={{ width: "100%", padding: 12, background: "#28a745", color: "#fff", border: "none", borderRadius: 4 }}
      >
        {loading ? "처리 중..." : "계정 생성 / 자동 로그인"}
      </button>

      <button
        onClick={() => hardGo("/login")}
        style={{ width: "100%", padding: 12, background: "#007bff", color: "#fff", border: "none", borderRadius: 4, marginTop: 10 }}
      >
        로그인 페이지로 이동
      </button>
    </div>
  );
}
