import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/data/refresh";

// The refresh must never be cached, and should run on demand.
export const dynamic = "force-dynamic";

const SEASON = 2025;

/**
 * Manual refresh (header ↻ button): incrementally pull NEW/changed data from
 * the FIRST API and recompute the derived fields. Same runner as the
 * traffic-driven auto-refresh, but bypasses its cadence backoff.
 */
export async function POST() {
  try {
    const res = await runRefresh(SEASON);
    if (!res) {
      return NextResponse.json({ error: "A refresh is already running." }, { status: 409 });
    }
    return NextResponse.json({
      changed: res.changed,
      newEvents: res.newEvents,
      updatedEvents: res.updatedEvents,
      newMatches: res.newMatches,
      ms: res.ms,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
