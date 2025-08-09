"use client"; // 이 줄을 맨 위에 꼭 추가해야 합니다!

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// 이전에 만들었던 Supabase 클라이언트를 다시 만듭니다.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function LoginPage() {
  // 사용자가 입력하는 이메일과 비밀번호를 기억할 공간을 만듭니다.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 로그인 버튼을 눌렀을 때 실행될 함수
  const handleLogin = async () => {
    console.log("로그인 시도:", email, password); // 입력값이 잘 들어오는지 확인

    // Supabase에 이메일과 비밀번호로 로그인을 요청합니다.
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      console.error("로그인 에러:", error);
      alert("로그인에 실패했습니다: " + error.message);
    } else {
      console.log("로그인 성공!", data);
      alert("로그인에 성공했습니다!");
    }
  };

  return (
    <div>
      <h1>로그인 페이지</h1>
      {/* 입력창에 글자를 쓸 때마다 email, password 변수에 값을 저장합니다. */}
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
      {/* 버튼을 클릭하면 handleLogin 함수를 실행합니다. */}
      <button onClick={handleLogin}>로그인</button>
    </div>
  );
}