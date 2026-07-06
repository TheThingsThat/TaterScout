"use client";

import Link from "next/link";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";

export default function ScoutNav() {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  return (
    <header className="sticky top-0 z-40 border-b border-[#161616] bg-black/80 backdrop-blur-[14px]">
      <div className="mx-auto flex max-w-[900px] items-center justify-between px-4 py-3">
        <Link href="/scout" className="flex items-center gap-2 no-underline">
          <span className="font-mono text-[13px] font-bold tracking-[0.2em] text-foreground">
            TATERSCOUT
          </span>
          <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
            Scout
          </span>
        </Link>
        <div className="flex items-center gap-3 text-[13px]">
          <Link href="/" className="text-muted no-underline hover:text-foreground">
            ← Site
          </Link>
          {isAuthenticated && (
            <button
              onClick={() => signOut()}
              className="rounded-lg border border-[#232323] px-3 py-1.5 text-muted transition-colors hover:border-[#3a3a3a] hover:text-foreground"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
