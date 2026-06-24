"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/rankings", label: "Rankings" },
  { href: "/about", label: "About" },
];

export default function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex shrink-0 items-center gap-4 sm:gap-[26px]">
      {ITEMS.map((it) => {
        const active = path?.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className="flex items-center gap-1.5 text-[14px] transition-colors hover:text-foreground"
            style={{ color: active ? "#f4f5f7" : "#9aa0aa" }}
          >
            {it.label}{" "}
            <span className="hidden text-[10px] text-[#3a3f48] sm:inline">✦</span>
          </Link>
        );
      })}
    </nav>
  );
}
