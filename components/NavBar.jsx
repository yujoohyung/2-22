"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** 네비게이션 탭 정의 */
const tabs = [
  { label: "나스닥2배", path: "/dashboard" },
  { label: "빅테크2배", path: "/stock2" },
  { label: "총합",      path: "/total" },
  { label: "예치금",    path: "/cash" },
];

/** NavBar를 숨길 경로들 */
const HIDE = new Set(["/login", "/signup", "/logout"]);

/** 지정 경로 및 그 하위 경로까지 숨김 */
function shouldHide(pathname) {
  if (!pathname) return false;
  if (HIDE.has(pathname)) return true;
  for (const p of HIDE) {
    if (pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export default function NavBar() {
  const pathname = usePathname() || "/";

  // 로그인/회원가입/로그아웃 페이지에서는 렌더링 안 함
  if (shouldHide(pathname)) return null;

  return (
    <header style={styles.header}>
      <nav style={styles.nav} aria-label="주요 탭">
        {tabs.map((t) => {
          const active =
            pathname === t.path || pathname.startsWith(t.path + "/");
          const style = {
            ...styles.btn,
            ...(active ? styles.active : {}),
          };

          return (
            <Link
              key={t.path}
              href={t.path}
              style={style}
              aria-current={active ? "page" : undefined}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

const styles = {
  header: {
    position: "sticky",
    top: 0,
    zIndex: 50,
    background: "#fff",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "#eee",
    padding: "10px 0",
  },
  nav: {
    maxWidth: 960,
    margin: "0 auto",
    padding: "0 12px",
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
  },
  btn: {
    flex: 1,
    textAlign: "center",
    padding: "10px 0",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#ddd",
    borderRadius: 10,
    fontWeight: 600,
    textDecoration: "none",
    color: "#111",
    background: "#fff",
    transition: "border-color .15s ease, background .15s ease",
  },
  active: {
    borderColor: "#111",
    background: "#fafafa",
  },
};
