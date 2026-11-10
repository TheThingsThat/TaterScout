"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While an event is ongoing, periodically re-fetch the server component so
 *  predictions and scores update as matches are scored. Renders nothing. The
 *  scheduled sync writes fresh data to the store; this poll surfaces it to the
 *  open page (serverless stand-in for a live push). */
export default function LiveRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    // Counted, not a flag, so one LiveRefresh unmounting can't clear another's.
    // Heartbeat reads it: these refreshes already schedule the sync.
    const root = document.documentElement;
    root.dataset.live = String(Number(root.dataset.live ?? 0) + 1);
    // ~1/min with jitter, so a venue's tabs (one NAT IP, one rate-limit bucket)
    // don't refresh in lockstep. Syncs land minutes apart anyway.
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(() => {
        if (!document.hidden) router.refresh();
        tick();
      }, 60_000 + Math.random() * 15_000);
    };
    tick();
    return () => {
      clearTimeout(t);
      root.dataset.live = String(Number(root.dataset.live ?? 1) - 1);
    };
  }, [enabled, router]);
  return null;
}
