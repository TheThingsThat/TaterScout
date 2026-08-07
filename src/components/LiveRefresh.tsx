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
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [enabled, router]);
  return null;
}
