import { NextResponse } from "next/server";
import { readRefreshMeta } from "@/lib/data/refresh";

// Lightweight freshness probe for the header "Updated Xs ago" stamp: seconds
// since the last completed sync (any instance), read fresh from meta.
export const dynamic = "force-dynamic";

const SEASON = 2025;

export async function GET() {
  const meta = await readRefreshMeta(SEASON);
  const secondsAgo = meta.lastSyncAt
    ? Math.max(0, Math.round((Date.now() - meta.lastSyncAt) / 1000))
    : null;
  return NextResponse.json(
    { secondsAgo },
    { headers: { "Cache-Control": "public, max-age=5" } },
  );
}
