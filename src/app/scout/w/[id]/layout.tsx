"use client";

import { use, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, Authenticated, AuthLoading } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

function Tabs({ id }: { id: Id<"workspaces"> }) {
  const data = useQuery(api.workspaces.get, { workspaceId: id });
  const path = usePathname();
  const base = `/scout/w/${id}`;
  const isAdmin = data?.member.role === "admin";
  const tabs = [
    { href: base, label: "Overview", exact: true },
    ...(isAdmin ? [{ href: `${base}/setup`, label: "Setup" }] : []),
    { href: `${base}/teams`, label: "Teams" },
    { href: `${base}/pit`, label: "Pit" },
    { href: `${base}/match`, label: "Match" },
    { href: `${base}/picklist`, label: "Pick list" },
  ];
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-[#161616]">
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-[14px] no-underline transition-colors ${
              active
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <>
      <AuthLoading>
        <div className="pt-10 text-center text-sm text-muted">Loading…</div>
      </AuthLoading>
      <Authenticated>
        <Tabs id={id as Id<"workspaces">} />
        {children}
      </Authenticated>
    </>
  );
}
