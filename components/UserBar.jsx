// components/UserBar.jsx
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export default function UserBar() {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClientComponentClient();
  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(true);

  const prettyName = (em) => {
    if (!em) return "";
    const local = em.split("@")[0] || em;
    return `${local}님`;
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!ignore) setEmail(data.user?.email ?? null);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => {
      ignore = true;
      sub.subscription?.unsubscribe?.();
    };
  }, [supabase]);

  const onLogout = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      setEmail(null); // 즉시 숨김
      router.replace("/login");
    }
  };

  if (loading || !email || pathname?.startsWith("/login")) return null;

  return (
    <div style={bar}>
      <div style={inner}>
        <span style={who}>
          <strong style={nameStrong}>{prettyName(email)}</strong>
        </span>
        <button onClick={onLogout} style={btnOutline}>로그아웃</button>
      </div>
    </div>
  );
}

const bar = {
  position: "fixed",
  left: 0, right: 0, bottom: 0,
  height: "50px",
  background: "#ffffff",
  borderTop: "1px solid #e5e7eb",
  padding: "0 16px",
  display: "flex",
  alignItems: "center",
  zIndex: 50,
};

const inner = {
  maxWidth: 1100, margin: "0 auto", width: "100%",
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
};

const who = { color: "#111827", fontSize: 14 };
const nameStrong = { color: "#2563eb", fontWeight: 600 };
const btnOutline = {
  background: "#ffffff", color: "#2563eb", border: "1px solid #2563eb",
  padding: "6px 12px", borderRadius: 8, fontSize: 14, cursor: "pointer",
};
