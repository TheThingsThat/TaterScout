"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary. The realistic trigger is the FIRST API being
 * down, slow, or rate-limited — team/event pages fetch it live — which happens
 * most on competition Saturdays, exactly when traffic peaks. Without this, Next
 * serves a bare unstyled "Application error" with no header, footer, or way
 * back.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[page error]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[64vh] max-w-[1240px] place-items-center justify-center px-8 text-center">
      <div className="relative">
        <div
          className="hero-dots pointer-events-none absolute z-0 opacity-50"
          style={{
            inset: "-60px",
            WebkitMaskImage: "radial-gradient(320px 220px at 50% 50%, #000 0%, transparent 72%)",
            maskImage: "radial-gradient(320px 220px at 50% 50%, #000 0%, transparent 72%)",
          }}
        />
        <div className="relative z-[1]">
          <div className="text-[clamp(60px,10vw,110px)] font-bold leading-none tracking-[-0.02em] text-accent">
            ⚠
          </div>
          <h1 className="mt-[18px] text-[24px] font-semibold text-[#f7f8fa]">
            Couldn&apos;t load live data
          </h1>
          <p className="mt-2.5 max-w-[30rem] text-[15px] text-muted">
            This page pulls schedules and scores from the FIRST API, which looks
            unreachable right now. Rankings and team stats served from our own
            data should still work.
          </p>
          <div className="mt-[26px] flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={reset}
              className="inline-flex items-center gap-2.5 rounded-full bg-accent px-[22px] py-3 text-[15px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Try again
            </button>
            <Link
              href="/rankings"
              className="inline-flex items-center gap-2.5 rounded-full border border-[#232323] px-[22px] py-3 text-[15px] text-muted no-underline transition-colors hover:border-[#3a3a3a] hover:text-foreground"
            >
              Go to rankings
            </Link>
          </div>
          {error.digest && (
            <p className="mt-4 font-mono text-[11px] text-[#52565e]">ref {error.digest}</p>
          )}
        </div>
      </div>
    </div>
  );
}
