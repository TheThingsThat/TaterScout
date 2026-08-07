// Traffic-driven freshness: any page view schedules a post-response staleness
// check (Next `after()` — runs AFTER the response is sent, so pages never wait
// on ingest). If the store is due for a sync, run the shared incremental
// refresh. Serverless-friendly: no daemon, no cron — visitors are the clock.
//
// Cadence lives in refresh.ts meta: 60s while results are flowing, 120s during
// a quiet active window, 30min when no events are on (off-season). Races
// between instances just produce a duplicate idempotent sync (bounded by the
// meta claim below), never wrong data.
//
// NOTE: imports next/server — only import this module from app code (server
// components / routes), never from CLI scripts.
import { after } from "next/server";
import { unstable_cache } from "next/cache";
import { runRefresh, readSyncState, type SyncState } from "./refresh";

const ATTEMPT_MS = 30_000; // per-instance: skip even the meta read this often
let lastAttempt = 0;

/** Sync state through a short shared cache. The status route and tick() both
 *  use this, so heartbeat tabs and page views collapse to ≤4 Convex reads/min
 *  fleet-wide instead of one uncached read per instance per tick. Freshness is
 *  only a pre-check — runRefresh's atomic claim is the real lock, and a ≤15s
 *  stale "due" just costs one no-op claim. */
export const cachedSyncState = (season: number): Promise<SyncState | null> =>
  unstable_cache(async () => readSyncState(season), ["sync-state", String(season)], {
    revalidate: 15,
  })();

/** Call during render of any data page. Cheap no-op when recently attempted. */
export function scheduleAutoRefresh(season: number): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return; // not at build
  const now = Date.now();
  if (now - lastAttempt < ATTEMPT_MS) return;
  lastAttempt = now;
  try {
    after(() => tick(season));
  } catch {
    // Outside a request context (e.g. some prerender paths) — skip quietly.
  }
}

async function tick(season: number): Promise<void> {
  try {
    // Cheap pre-check: skip when not due. The real cross-instance lock is
    // runRefresh's atomic Convex claim — this read just avoids pointless
    // claim attempts from every instance.
    const state = await cachedSyncState(season);
    if (state && Date.now() < state.nextCheckAt) return;

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
