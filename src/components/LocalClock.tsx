"use client";

import { useSyncExternalStore } from "react";
import { formatClock, formatDate } from "@/lib/format";

const subscribe = () => () => {};

/** Clock time rendered in the VIEWER's timezone. Server components can't know
 *  the visitor's tz, so SSR/hydration emits the event-local time (fallback) and
 *  the first client render swaps in the browser-local one — the React-blessed
 *  useSyncExternalStore pattern, no hydration mismatch. */
export default function LocalClock({
  ms,
  fallbackTimezone,
  date = false,
}: {
  ms: number | null;
  fallbackTimezone?: string;
  date?: boolean; // the viewer's calendar date ("Nov 8, 2026") instead of the time
}) {
  const text = useSyncExternalStore(
    subscribe,
    // client: browser-local
    () => (date ? formatDate(ms, { local: true }) : formatClock(ms)),
    // SSR: event-local placeholder (UTC for dates)
    () => (date ? formatDate(ms) : formatClock(ms, fallbackTimezone)),
  );
  return <>{text}</>;
}
