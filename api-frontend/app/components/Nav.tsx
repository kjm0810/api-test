"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav-links">
      <Link href="/" className={pathname === "/" ? "active" : ""}>콘솔</Link>
      <Link href="/overlay-setting" className={pathname.includes("/overlay-setting") ? "active" : ""}>오버레이</Link>
    </nav>
  );
}
