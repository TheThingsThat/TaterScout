import { NextResponse, type NextRequest, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runRefresh, readSyncState } from "@/lib/data/refresh";

// On-demand, never cached; allow up to 60s for a recompute.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEASON = 2025;

/**
 * Both methods trigger credentialed FIRST API crawls + dataset writes, so both
 * require CRON_SECRET. Fails CLOSED in production: a deploy that forgets the var
 * gets 503, not an open endpoint. Locally (no secret, not production) it's open.
 */
function authorize(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Refresh is not configured." }, { status: 503 });
    }
    return null; // local dev
  }
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return ok ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

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
    skipped304: res.skipped304,
    rankSynced: res.rankSynced,
    wrote: res.wrote,
    ms: res.ms,
  });
}

/**
 * Scheduled sync (Vercel Cron or an external minute trigger). Emulates
 * ftc-scout's minute loop: an ongoing-events-only incremental pull from the
 * FIRST API + recompute, no traffic required. Guarded by CRON_SECRET — Vercel
 * Cron sends `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  // Respond immediately and sync AFTER the response, so the caller (cron-job.org,
  // 30s timeout) never waits on ingest/recompute. Self-throttle via the shared
  // cadence so an every-minute cron only does real work when the store is due.
  after(async () => {
    try {
      const state = await readSyncState(SEASON);
      if (state && Date.now() < state.nextCheckAt) return; // not due yet — skip cheaply
      const res = await runRefresh(SEASON);
      if (res?.changed) {
        console.log(`[cron refresh] +${res.newMatches} matches in ${res.ms}ms`);
      }
    } catch (e) {
      console.error("[cron refresh]", (e as Error).message);
    }
  });
  return NextResponse.json({ scheduled: true });
}

/**
 * Manual refresh: forces a full ±14/+3-day sweep so an explicit call re-checks
 * recently-finished events too. `?full=1` additionally rewrites EVERY Convex
 * row (fingerprint-reset escape hatch after partial failures or reseeds).
 */
export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  try {
    const full = req.nextUrl.searchParams.get("full") === "1";
    return summarize(await runRefresh(SEASON, { wide: true, full }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
