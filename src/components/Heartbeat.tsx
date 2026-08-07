"use client";

import { useEffect } from "react";

/** Presence-driven refresh trigger. While a tab is open AND visible, ping the
 *  status endpoint every minute; each hit schedules the same throttled sync
 *  that page renders do ("visitors are the clock"), so someone parked on the
 *  site keeps EPA/OPR/rankings recomputing without any cron. Hidden tabs stay
 *  silent. Renders nothing. */
export default function Heartbeat() {
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/status", { cache: "no-store" }).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return null;
}
