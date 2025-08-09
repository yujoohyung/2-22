"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "1번 주식", path: "/stock1" },
  { label: "2번 주식", path: "/stock2" },
  { label: "총합",   path: "/total"  },
  { label: "예치금", path: "/cash"   },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <header style={styles.header}>
      <nav style={styles.nav}>
        {tabs.map((t) => {
          const active = pathname === t.path;
          return (
            <Link
              key={t.path}
              href={t.path}
              style={{ ...styles.btn, ...(active ? styles.active : null) }}
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
    borderBottom: "1px solid #eee",
    padding: "10px 0",
  },
  nav: {
    maxWidth: 960,
    margin: "0 auto",
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
  },
  btn: {
    flex: 1,
    textAlign: "center",
    padding: "10px 0",
    border: "1px solid #ddd",
    borderRadius: 10,
    fontWeight: 600,
    textDecoration: "none",
    color: "#111",
    background: "#fff",
  },
  active: {
    borderColor: "#111",
  },
};
