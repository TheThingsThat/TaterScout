// Shared refresh runner: pull NEW/changed events from the FIRST API, recompute
// the derived datasets, persist. Used by the manual /api/refresh route AND the
// traffic-driven auto-refresh (autoRefresh.ts) so both stay one implementation.
import { getRawEvents, applyComputed, persist } from "./store";
import { fetchDeltas, fetchAllEvents } from "./crawl";
import { computeSeasonData } from "./compute";
import { readDataset, writeDataset } from "./storage";

export interface RefreshSummary {
  changed: boolean;
  newEvents: number;
  updatedEvents: number;
  newMatches: number;
  windowSize: number; // events in the active window (0 = idle/off-season)
  ms: number;
}

/** Sync coordination state, shared across serverless instances via storage. */
export interface RefreshMeta {
  lastSyncAt: number; // when a sync last completed (any instance)
  nextCheckAt: number; // don't auto-sync again before this
  lastWideAt?: number; // when the last wide (±14/+3d) sweep ran
}

export async function readRefreshMeta(season: number): Promise<RefreshMeta> {
  try {
    const s = await readDataset(`meta-${season}`);
    if (s) return JSON.parse(s) as RefreshMeta;
  } catch {
    /* corrupt/missing meta -> defaults */
  }
  return { lastSyncAt: 0, nextCheckAt: 0 };
}

export async function writeRefreshMeta(season: number, meta: RefreshMeta): Promise<void> {
  try {
    await writeDataset(`meta-${season}`, JSON.stringify(meta));
  } catch {
    /* best-effort — a lost meta write only costs an extra check */
  }
}

// Adaptive cadence: sync often while results are flowing, back off when quiet.
const NEXT_AFTER_CHANGE_MS = 60_000; // matches ~7-min FTC cycle with headroom
const NEXT_AFTER_QUIET_MS = 120_000; // active window but nothing changed
const NEXT_AFTER_IDLE_MS = 30 * 60_000; // no active events (off-season)

// The frequent path scopes to ongoing events only (ftc-scout's Partial); a wider
// ±14/+3d sweep runs at most this often to catch late score corrections to
// just-finished events (their daily Full-load analog).
const WIDE_INTERVAL_MS = 30 * 60_000;

let inFlight = false; // per-instance; cross-instance dupes are idempotent

/**
 * Run one incremental sync. Returns null if a sync is already running in this
 * instance. Scope is ongoing-only unless a wide sweep is due (or `opts.wide` is
 * set — the manual button forces one). Updates the shared meta.
 */
export async function runRefresh(
  season: number,
  opts: { wide?: boolean } = {},
): Promise<RefreshSummary | null> {
  if (inFlight) return null;
  inFlight = true;
  const t0 = Date.now();
  try {
    // Working copy of the ingested events; seed via a full crawl if none exists.
    let raw = await getRawEvents(season);
    if (!raw) raw = await fetchAllEvents(season);

    const meta = await readRefreshMeta(season);
    const wide = opts.wide === true || Date.now() - (meta.lastWideAt ?? 0) > WIDE_INTERVAL_MS;

    // Ongoing-only (cheap, minute-cadence) vs the wider periodic sweep.
    const delta = await fetchDeltas(
      season,
      raw,
      wide ? {} : { lookbackDays: 0, lookaheadDays: 0 },
    );

    if (delta.changed) {
      // Recompute (EPA is a global replay; OPR/sim/trajectories/world-record/
      // search index all derive from the event set).
      const computed = computeSeasonData(season, delta.events);
      applyComputed(season, delta.events, computed);
      await persist(season);
    }

    const now = Date.now();
    await writeRefreshMeta(season, {
      lastSyncAt: now,
      lastWideAt: wide ? now : (meta.lastWideAt ?? 0),
      nextCheckAt:
        now +
        (delta.changed
          ? NEXT_AFTER_CHANGE_MS
          : delta.windowSize > 0
            ? NEXT_AFTER_QUIET_MS
            : NEXT_AFTER_IDLE_MS),
    });

    return {
      changed: delta.changed,
      newEvents: delta.newEvents.length,
      updatedEvents: delta.updatedEvents.length,
      newMatches: delta.newMatches,
      windowSize: delta.windowSize,
      ms: Date.now() - t0,
    };
  } finally {
    inFlight = false;
  }
}
