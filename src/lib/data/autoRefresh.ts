// Traffic-driven freshness: any page view schedules a post-response staleness
// check (Next `after()` — runs AFTER the response is sent, so pages never wait
// on ingest). If the store is due for a sync, run the shared incremental
// refresh. Serverless-friendly: no daemon, no cron — visitors are the clock.
//
// Cadence lives in refresh.ts. Races between instances are settled by its atomic
// Convex claim, never by wrong data.
//
// NOTE: imports next/server — only import this module from app code (server
// components / routes), never from CLI scripts.
import { after } from "next/server";
import { CURRENT_SEASON } from "@/lib/season";
import { runRefresh, nextSyncDueAt } from "./refresh";

const ATTEMPT_MS = 30_000; // per-instance: skip even the claim this often
let lastAttempt = 0;

/** Call during render of any data page. Cheap no-op when recently attempted.
 *  Only production syncs, and only the current season: past seasons don't change,
 *  and a dev or preview server would run the real worker against shared quotas
 *  (POST /api/refresh still works there for a manual sync). */
export function scheduleAutoRefresh(season: number): void {
  if (season !== CURRENT_SEASON || process.env.VERCEL_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return; // not at build
  const now = Date.now();
  if (now < lastAttempt + ATTEMPT_MS || now < nextSyncDueAt()) return;
  lastAttempt = now;
  try {
    after(() => tick(season));
  } catch {
    // Outside a request context (e.g. some prerender paths) — skip quietly.
  }
}

async function tick(season: number): Promise<void> {
  try {
    const res = await runRefresh(season);
    if (res?.changed) {
      console.log(
        `[auto-refresh] synced: +${res.newMatches} matches (${res.newEvents} new / ${res.updatedEvents} updated events, ${res.skipped304} skipped via 304) in ${res.ms}ms`,
      );
    }
  } catch (e) {
    // Never let background sync surface to a page; next visitor retries.
    console.warn(`[auto-refresh] failed: ${(e as Error).message}`);
  }
}
