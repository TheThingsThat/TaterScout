"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While an event is ongoing, periodically re-fetch the server component so
 *  predictions and scores update as matches are scored. Renders nothing. */
export default function LiveRefresh({
  enabled,
  intervalSec = 60,
}: {
  enabled: boolean;
  intervalSec?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => router.refresh(), intervalSec * 1000);
    return () => clearInterval(id);
  }, [enabled, intervalSec, router]);
  return null;
}
