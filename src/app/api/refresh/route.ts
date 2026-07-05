import { NextResponse, type NextRequest } from "next/server";
import { runRefresh } from "@/lib/data/refresh";

// On-demand, never cached; allow up to 60s for a recompute.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEASON = 2025;

function summarize(res: Awaited<ReturnType<typeof runRefresh>>) {
  if (!res) {
    return NextResponse.json({ error: "A refresh is already running." }, { status: 409 });
  }
  return NextResponse.json({
    changed: res.changed,
    newEvents: res.newEvents,
    updatedEvents: res.updatedEvents,
    newMatches: res.newMatches,
    windowSize: res.windowSize,
    ms: res.ms,
  });
}

/**
 * Scheduled sync (Vercel Cron or an external minute trigger). Emulates
 * ftc-scout's minute loop: an ongoing-events-only incremental pull from the
 * FIRST API + recompute, no traffic required. Guarded by CRON_SECRET — Vercel
 * Cron sends `Authorization: Bearer <CRON_SECRET>`; when the var is unset (local
 * dev) the endpoint is open.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return summarize(await runRefresh(SEASON));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * Manual refresh (header ↻ button): same runner, but forces a full ±14/+3-day
 * sweep so an explicit click re-checks recently-finished events too.
 */
export async function POST() {
  try {
    return summarize(await runRefresh(SEASON, { wide: true }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
