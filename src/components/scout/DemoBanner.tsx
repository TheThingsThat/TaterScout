"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";

const SEEN_KEY = "taterscout-demo-notice-seen";

/** Keep the session alive while the tab is open, comfortably inside the 2h TTL. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export default function DemoBanner() {
  const status = useQuery(api.demo.status);
  const start = useMutation(api.demo.start);
  const touch = useMutation(api.demo.touch);
  const endDemo = useMutation(api.demo.end);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [ending, setEnding] = useState(false);

  const isDemo = status?.isDemo === true;
  // Derived, not effect-driven state: the notice is simply "we're in demo mode,
  // this session hasn't seen it, and it hasn't been dismissed."
  const showNotice =
    isDemo && !dismissed && typeof window !== "undefined" && !sessionStorage.getItem(SEEN_KEY);

  // Register the expiry timer (idempotent) now that auth has settled, then hold
  // it open while someone is actually using the demo.
  useEffect(() => {
    if (!isDemo) return;
    void start({});
    const id = setInterval(() => void touch({}), TOUCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isDemo, start, touch]);

  // Wipe on leave. `pagehide` (not `beforeunload`) is the event that still fires
  // reliably on mobile, and sendBeacon survives the page going away where a
  // normal fetch would be cancelled.
  //
  // The `persisted` check matters: backgrounding a tab on iOS fires pagehide
  // with persisted=true because the page is going into the back/forward cache
  // and may well come back. Wiping there would delete someone's work just
  // because they answered a text message. Only a real teardown wipes.
  useEffect(() => {
    if (!isDemo) return;
    const onPageHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      navigator.sendBeacon("/api/scout/demo-end");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [isDemo]);

  if (!isDemo) return null;

  async function onEnd() {
    if (!confirm("End the demo and delete everything you created? This can't be undone.")) return;
    setEnding(true);
    try {
      await endDemo({});
      await signOut();
      router.replace("/scout/sign-in");
    } finally {
      setEnding(false);
    }
  }

  function dismissNotice() {
    sessionStorage.setItem(SEEN_KEY, "1");
    setDismissed(true);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-gold/25 bg-gold/[0.07] px-4 py-2 text-[12px]">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
          Demo mode
        </span>
        <span className="text-muted">
          Everything here is deleted when you close this tab.
        </span>
        <span className="text-[#6b6f78]">
          {status.workspacesUsed} / {status.maxWorkspaces} workspaces
        </span>
        <button
          onClick={onEnd}
          disabled={ending}
          className="ml-auto rounded-md border border-[#232323] px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-[#3a3a3a] hover:text-foreground disabled:opacity-60"
        >
          {ending ? "Ending…" : "End demo"}
        </button>
      </div>

      {showNotice && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-notice-title"
          className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-5"
        >
          <div className="w-full max-w-[420px] rounded-2xl border border-[#232323] bg-surface p-6">
            <h2 id="demo-notice-title" className="text-[18px] font-semibold">
              You&apos;re in demo mode
            </h2>
            <p className="mt-2.5 text-[14px] leading-relaxed text-muted">
              If you close the tab, everything is wiped — workspaces, reports, and
              assignments are all deleted from the server. Nothing here is saved.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[#6b6f78]">
              You can create up to {status.maxWorkspaces} workspaces. Want to keep your
              work? Create a free account instead.
            </p>
            <button
              onClick={dismissNotice}
              autoFocus
              className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-[15px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
