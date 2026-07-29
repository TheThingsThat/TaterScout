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
import { runRefresh, readRefreshMeta, writeRefreshMeta } from "./refresh";

const ATTEMPT_MS = 30_000; // per-instance: skip even the meta read this often
let lastAttempt = 0;

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
    const meta = await readRefreshMeta(season);
    const now = Date.now();
    if (now < meta.nextCheckAt) return;

    // Optimistic claim so parallel instances mostly don't double-sync; the
    // real nextCheckAt is written by runRefresh when it finishes. Carry
    // lastWideAt through — dropping it made runRefresh think a wide sweep was
    // always due, so every tick re-crawled the whole ±14/+3-day window.
    await writeRefreshMeta(season, {
      lastSyncAt: meta.lastSyncAt,
      lastWideAt: meta.lastWideAt,
      nextCheckAt: now + 90_000,
    });

    const res = await runRefresh(season);
    if (res?.changed) {
      console.log(
        `[auto-refresh] synced: +${res.newMatches} matches (${res.newEvents} new / ${res.updatedEvents} updated events) in ${res.ms}ms`,
      );
    }
  } catch (e) {
    // Never let background sync surface to a page; next visitor retries.
    console.warn(`[auto-refresh] failed: ${(e as Error).message}`);
  }
}
