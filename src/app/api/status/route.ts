import { NextResponse } from "next/server";
import { scheduleAutoRefresh, cachedSyncState } from "@/lib/data/autoRefresh";

// Freshness probe (seconds since the last completed sync) that doubles as the
// presence heartbeat target: each hit schedules the same throttled post-response
// sync the page renders do, so an idle-but-open tab keeps the store updating.
export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for the after()-scheduled sync

const SEASON = 2025;

export async function GET() {
  scheduleAutoRefresh(SEASON); // no-op unless the store is due (shared cadence)
  const state = await cachedSyncState(SEASON); // 15s shared cache (autoRefresh)
  const secondsAgo = state?.lastSyncAt
    ? Math.max(0, Math.round((Date.now() - state.lastSyncAt) / 1000))
    : null;
  return NextResponse.json(
    { secondsAgo },
    { headers: { "Cache-Control": "public, max-age=5" } },
  );
}
