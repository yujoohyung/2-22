"use client";

import { usePathname } from "next/navigation";
import NavBar from "./NavBar";

const HIDE = new Set(["/login", "/signup", "/logout"]);

export default function AppFrame({ children }) {
  const pathname = usePathname() || "/";

  // /login, /signup, /logout 및 하위 경로에서도 숨김
  const hideNav =
    HIDE.has(pathname) ||
    Array.from(HIDE).some((p) => pathname.startsWith(p + "/"));

  return (
    <>
      {!hideNav && <NavBar />}
      {children}
    </>
  );
}
