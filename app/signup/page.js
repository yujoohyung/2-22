"use client";

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSignUp = async () => {
    console.log("--- 회원가입 시도 시작 ---");
    console.log("입력된 이메일:", email);

    // Supabase에 회원가입 요청
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
    });

    // --- Supabase 응답 결과 상세 분석 ---
    if (error) {
      console.error("Supabase 에러 객체:", error);
      alert("회원가입 실패: " + error.message);
    } else {
      console.log("Supabase 응답 데이터:", data);
      
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        console.warn("경고: 이미 가입된 이메일일 수 있습니다.");
        alert("이미 가입된 이메일입니다. 로그인하거나 다른 이메일을 사용해주세요.");
      } else if (data.user) {
        console.log("성공: 사용자 객체가 존재합니다. 인증 메일을 확인하세요.");
        alert("회원가입 요청 성공! 이메일을 확인하여 계정을 활성화해주세요.");
      } else {
        console.error("알 수 없는 성공 응답. 사용자 데이터가 없습니다:", data);
        alert("알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      }
    }
    console.log("--- 회원가입 시도 종료 ---");
  };

  return (
    <div>
      <h1>회원가입 페이지 (상세 분석 모드)</h1>
      <input 
        type="email" 
        placeholder="이메일"
        value={email}
        onChange={(e) => setEmail(e.target.value)} 
      />
      <input 
        type="password" 
        placeholder="비밀번호"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={handleSignUp}>회원가입</button>
    </div>
  );
}