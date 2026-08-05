import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { readSyncState } from "@/lib/data/refresh";
import { scheduleAutoRefresh } from "@/lib/data/autoRefresh";

// Freshness probe (seconds since the last completed sync) that doubles as the
// presence heartbeat target: each hit schedules the same throttled post-response
// sync the page renders do, so an idle-but-open tab keeps the store updating.
export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for the after()-scheduled sync

const SEASON = 2025;

// Sync state lives in Convex now; a 15s shared cache keeps heartbeat tabs from
// each hitting it directly.
const cachedState = unstable_cache(async () => readSyncState(SEASON), ["sync-state", String(SEASON)], {
  revalidate: 15,
});

export async function GET() {
  scheduleAutoRefresh(SEASON); // no-op unless the store is due (shared cadence)
  const state = await cachedState();
  const secondsAgo = state?.lastSyncAt
    ? Math.max(0, Math.round((Date.now() - state.lastSyncAt) / 1000))
    : null;
  return NextResponse.json(
    { secondsAgo },
    { headers: { "Cache-Control": "public, max-age=5" } },
  );
}
