"use client";

import { useSyncExternalStore } from "react";
import { formatClock } from "@/lib/format";

const subscribe = () => () => {};

/** Clock time rendered in the VIEWER's timezone. Server components can't know
 *  the visitor's tz, so SSR/hydration emits the event-local time (fallback) and
 *  the first client render swaps in the browser-local one — the React-blessed
 *  useSyncExternalStore pattern, no hydration mismatch. */
export default function LocalClock({
  ms,
  fallbackTimezone,
}: {
  ms: number | null;
  fallbackTimezone?: string;
}) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatClock(ms), // client: browser-local
    () => formatClock(ms, fallbackTimezone), // SSR: event-local placeholder
  );
  return <>{text}</>;
}
