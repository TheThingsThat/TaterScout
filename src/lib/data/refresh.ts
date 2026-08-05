// Shared refresh runner: pull NEW/changed events from the FIRST API, recompute
// the derived datasets, and push ONLY the changed rows into Convex (fingerprint
// diff — the Statbotics pattern). Used by the /api/refresh route AND the
// traffic-driven auto-refresh (autoRefresh.ts) so both stay one implementation.
//
// Flow per run: atomic claim (Convex CAS — the real multi-instance lock) →
// upstream gate (If-Modified-Since per window event; all 304 = done, no
// recompute) → full-season recompute → diffed batched push → persist worker
// state (raw + fingerprints, one gzipped object).
import { api } from "@convex/_generated/api";
import { fetchActiveWindow, fetchDeltas } from "./crawl";
import { computeSeasonData } from "./compute";
import { applyComputed, persist } from "./store";
import { loadWorkerState, saveWorkerState } from "./workerState";
import { buildSiteDocs, diffFingerprints } from "./fingerprint";
import { pushSiteDocs, invalidateKeys, syncTargetFromEnv, type PushCounts } from "./syncPush";

export interface RefreshSummary {
  changed: boolean;
  newEvents: number;
  updatedEvents: number;
  newMatches: number;
  windowSize: number; // events in the active window (0 = idle/off-season)
  skipped304: number; // events skipped by the If-Modified-Since gate
  wrote: PushCounts | null;
  rankSynced: boolean;
  ms: number;
}

export interface SyncState {
  lastSyncAt: number;
  nextCheckAt: number;
  lastWideAt: number;
  lastRankSyncAt: number;
  lastChangedAt: number;
}

// Adaptive cadence: sync often while results are flowing, back off when quiet.
const NEXT_AFTER_CHANGE_MS = 60_000; // matches ~7-min FTC cycle with headroom
const NEXT_AFTER_QUIET_MS = 120_000; // active window but nothing changed
const NEXT_AFTER_IDLE_MS = 30 * 60_000; // no active events (off-season)

// The frequent path scopes to ongoing events only; a wider ±14/+3d sweep runs
// at most this often. Rank labels reconcile on the same cadence (user decision:
// EPA/OPR values live every sync, rank numbers may lag ≤30 min).
const WIDE_INTERVAL_MS = 30 * 60_000;

let inFlight = false; // per-instance; the Convex claim is the cross-instance lock

/** Current sync state straight from Convex (no cache — coordination signal). */
export async function readSyncState(season: number): Promise<SyncState | null> {
  const target = await syncTargetFromEnv(season);
  if (!target) return null;
  try {
    return await target.client.query(api.sync.state.get, { season });
  } catch {
    return null;
  }
}

/**
 * Run one incremental sync. Returns null when another instance holds the slot
 * (or one is in flight here). `wide` forces the ±14/+3d sweep; `full` forces a
 * complete rewrite of every row (manual reconcile escape hatch).
 */
export async function runRefresh(
  season: number,
  opts: { wide?: boolean; full?: boolean } = {},
): Promise<RefreshSummary | null> {
  if (inFlight) return null;
  inFlight = true;
  const t0 = Date.now();
  try {
    const target = await syncTargetFromEnv(season);
    if (!target) {
      throw new Error("Sync not configured: NEXT_PUBLIC_CONVEX_URL and SYNC_SECRET are required.");
    }

    // Atomic cross-instance claim (CAS on nextCheckAt). Manual runs force past
    // the cadence gate but still serialize through the same mutation.
    const manual = opts.wide === true || opts.full === true;
    const claim = await target.client.mutation(api.sync.state.claim, {
      secret: target.secret,
      season,
      holdMs: 90_000,
      force: manual,
    });
    if (!claim.claimed) return null;
    const state = claim.state;
    const now = Date.now();

    const wide = manual || now - (state.lastWideAt ?? 0) > WIDE_INTERVAL_MS;
    // Rank reconcile piggybacks the wide sweep, and only when data has actually
    // changed since the last reconcile (otherwise ranks can't have drifted).
    const rankSyncDue =
      opts.full === true || (wide && (state.lastChangedAt ?? 0) > (state.lastRankSyncAt ?? 0));

    // Worker state: memory-first; re-read from storage when another instance
    // has pushed since our copy was saved.
    const worker = await loadWorkerState(season, {
      staleIfSavedBefore: state.lastChangedAt > 0 ? state.lastChangedAt : undefined,
    });
    if (!worker || worker.events.length === 0) {
      throw new Error(
        `Raw cache not seeded for season ${season} — run scripts/build-epa.ts, then POST /api/refresh?full=1.`,
      );
    }

    // Upstream gate: conditional per-event /matches probes (304 = skip).
    const window = await fetchActiveWindow(
      season,
      wide ? undefined : 0,
      wide ? undefined : 0,
    );
    let freshness: Record<string, string> = {};
    if (window.length > 0 && window.length <= 200) {
      try {
        freshness = await target.client.query(api.sync.state.freshness, {
          season,
          paths: window.map((c) => `matches/${c}`),
        });
      } catch {
        /* no tokens — probes go unconditional this round */
      }
    }
    const delta = await fetchDeltas(season, worker.events, { window }, freshness);

    if (delta.tokens.length > 0) {
      try {
        await target.client.mutation(api.sync.state.putFreshness, {
          secret: target.secret,
          season,
          tokens: delta.tokens.slice(0, 200),
        });
      } catch {
        /* best-effort — a lost token only costs one extra 200 next round */
      }
    }

    const finish = async (changed: boolean, rankSynced: boolean) => {
      await target.client.mutation(api.sync.state.finish, {
        secret: target.secret,
        season,
        nextCheckAt:
          Date.now() +
          (changed
            ? NEXT_AFTER_CHANGE_MS
            : delta.windowSize > 0
              ? NEXT_AFTER_QUIET_MS
              : NEXT_AFTER_IDLE_MS),
        changed,
        wide,
        rankSynced,
      });
    };

    if (!delta.changed && !opts.full && !rankSyncDue) {
      await finish(false, false);
      return {
        changed: false,
        newEvents: 0,
        updatedEvents: 0,
        newMatches: 0,
        windowSize: delta.windowSize,
        skipped304: delta.skipped304,
        wrote: null,
        rankSynced: false,
        ms: Date.now() - t0,
      };
    }

    // Recompute the whole season (cheap, ~1-2s), then persist only the delta.
    const computed = computeSeasonData(season, delta.events);
    const { docs, fingerprints } = buildSiteDocs(computed);
    const mode = opts.full || rankSyncDue ? "full" : "stats";
    const prevFp = opts.full ? null : worker.fingerprints;
    const diff = diffFingerprints(fingerprints, prevFp, mode);

    let wrote: PushCounts;
    try {
      wrote = await pushSiteDocs(target, docs, diff);
    } catch (e) {
      // A failed batch may have landed partially: drop the attempted keys from
      // the fingerprint map so the next sync rewrites them (self-healing).
      await saveWorkerState(season, {
        savedAt: Date.now(),
        events: delta.events,
        fingerprints: invalidateKeys(fingerprints, diff),
      });
      throw e;
    }

    // Keep the in-process store fresh for file-mode readers, and best-effort
    // persist the legacy blobs during the transition (removed at cutover).
    applyComputed(season, delta.events, computed);
    try {
      await persist(season);
    } catch (e) {
      console.warn(`[refresh] legacy persist skipped: ${(e as Error).message}`);
    }

    await saveWorkerState(season, { savedAt: Date.now(), events: delta.events, fingerprints });
    await finish(true, mode === "full");

    return {
      changed: true,
      newEvents: delta.newEvents.length,
      updatedEvents: delta.updatedEvents.length,
      newMatches: delta.newMatches,
      windowSize: delta.windowSize,
      skipped304: delta.skipped304,
      wrote,
      rankSynced: mode === "full",
      ms: Date.now() - t0,
    };
  } finally {
    inFlight = false;
  }
}
