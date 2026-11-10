import { NextResponse } from "next/server";
import { scheduleAutoRefresh } from "@/lib/data/autoRefresh";
import { CURRENT_SEASON as SEASON } from "@/lib/season";

// The presence heartbeat target: each hit schedules the same throttled
// post-response sync the page renders do, so an idle-but-open tab keeps the
// store updating. Reads nothing itself, so a heartbeat costs no Convex usage.
export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for the after()-scheduled sync

export async function GET() {
  scheduleAutoRefresh(SEASON); // no-op unless the store is due (shared cadence)
  // s-maxage only: Vercel's CDN serves every tab in a region from one cached
  // response, so about one ping a minute per region reaches this function, which
  // is still enough to start any due sync. No max-age, so browsers don't cache it.
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "public, s-maxage=60" } });
}
