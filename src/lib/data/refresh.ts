// Shared refresh runner: pull NEW/changed events from the FIRST API, recompute
// the derived datasets, and push ONLY the changed rows into Convex (fingerprint
// diff — the Statbotics pattern). Used by the /api/refresh route AND the
// traffic-driven auto-refresh (autoRefresh.ts) so both stay one implementation.
//
// Flow per run: atomic claim (Convex CAS — the real multi-instance lock) →
// upstream gate (If-Modified-Since per window event; all 304 = done, worker state
// never loaded) → full-season recompute → diffed batched push → persist worker
// state (raw + fingerprints, one gzipped object).
import { api } from "@convex/_generated/api";
import { fetchActiveWindow, fetchDeltas, probeEvents, type FreshnessToken } from "./crawl";
import { computeSeasonData } from "./compute";
import { loadWorkerState, saveWorkerState } from "./workerState";
import { buildSiteDocs, diffFingerprints, fingerprintsAfterPush } from "./fingerprint";
import { chunk, pushSiteDocs, invalidateKeys, syncTargetFromEnv, type PushCounts } from "./syncPush";

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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Adaptive cadence, sized to Convex's free plan: EPA/OPR lag by this much, while
// scores on event pages stay live from FIRST.
const NEXT_AFTER_IDLE_MS = HOUR; // no active events (off-season)

function nextDelayMs(changed: boolean, windowSize: number, lastChangedAt: number, now: number): number {
  if (changed) {
    const month = new Date(now).getUTCMonth();
    return month === 11 || month <= 3 ? 10 * MINUTE : 5 * MINUTE; // Dec-Apr: peak, and the largest state file
  }
  if (windowSize === 0) return NEXT_AFTER_IDLE_MS;
  const quietFor = now - lastChangedAt;
  return quietFor < HOUR ? 15 * MINUTE : quietFor < 3 * HOUR ? 30 * MINUTE : HOUR;
}

// The frequent path scopes to ongoing events only. A -3/+1-day sweep runs hourly,
// and the full -14/+3-day sweep daily so late edits to older events still land.
const WIDE_INTERVAL_MS = HOUR;
const WIDE_LOOKBACK_DAYS = 3;
const WIDE_LOOKAHEAD_DAYS = 1;
const LONG_SWEEP_INTERVAL_MS = 24 * HOUR;

// EPA/OPR values update every sync; rank numbers may lag up to this long, because
// one change moves thousands of ranks (user decision).
const RANK_INTERVAL_MS = 24 * HOUR;

export const HOLD_MS = 90_000; // how long a claim blocks other instances
const FETCH_BUDGET_MS = 35_000; // leaves room for the recompute + push inside a 60s route
const LIST_RETRY_MS = 15 * MINUTE; // FIRST returned no events list; that isn't off-season

let inFlight = false; // per-instance; the Convex claim is the cross-instance lock
let nextDueAt = 0;

/** When this instance last learned the next sync is due (0 = unknown). Lets
 *  callers skip even the claim call until then. */
export const nextSyncDueAt = (): number => nextDueAt;

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
      holdMs: HOLD_MS,
      force: manual,
      wideAfterMs: WIDE_INTERVAL_MS,
      longAfterMs: LONG_SWEEP_INTERVAL_MS,
    });
    if (!claim.claimed) {
      nextDueAt = claim.state.nextCheckAt;
      return null;
    }
    const state = claim.state;
    const now = Date.now();
    nextDueAt = now + HOLD_MS;

    // A season with no saved state yet (a new season) sweeps as far as it can reach
    // on every run until something has been played and saved.
    const long = manual || claim.long || !state.workerStateSavedAt;
    const wide = long || claim.wide;
    // Ranks can only have drifted if data changed since the last reconcile.
    const rankSyncDue =
      opts.full === true ||
      ((state.lastChangedAt ?? 0) > (state.lastRankSyncAt ?? 0) &&
        now - (state.lastRankSyncAt ?? 0) > RANK_INTERVAL_MS);

    // Upstream gate: conditional per-event /matches probes (304 = skip).
    const listed = await fetchActiveWindow(
      season,
      long ? undefined : wide ? WIDE_LOOKBACK_DAYS : 0,
      long ? undefined : wide ? WIDE_LOOKAHEAD_DAYS : 0,
    );
    const window = listed ?? [];
    const freshness: Record<string, string> = {};
    try {
      // A full reconcile ignores tokens: a 304 only vouches for /matches.
      for (const codes of opts.full ? [] : chunk(window, 200)) {
        Object.assign(
          freshness,
          await target.client.query(api.sync.state.freshness, {
            season,
            paths: codes.map((c) => `matches/${c}`),
          }),
        );
      }
    } catch {
      /* no tokens — remaining probes go unconditional this round */
    }
    const deadline = t0 + FETCH_BUDGET_MS;
    const probes = await probeEvents(season, window, freshness, deadline);
    // Events with news this run couldn't read (probe or build failed); each retries.
    let readFailures = probes.failed;

    // Written only after the sync's work has landed: a token stored earlier would
    // turn a killed or failed run into a 304, and that update would be lost.
    const saveTokens = async (tokens: FreshnessToken[]) => {
      try {
        for (const batch of chunk(tokens, 200)) {
          await target.client.mutation(api.sync.state.putFreshness, {
            secret: target.secret,
            season,
            tokens: batch,
          });
        }
      } catch {
        /* best-effort — a lost token only costs one extra 200 next round */
      }
    };

    const finish = async (changed: boolean, rankSynced: boolean) => {
      // Anything left unread gets the quick cadence, not the idle one.
      nextDueAt =
        Date.now() +
        (listed
          ? nextDelayMs(changed || readFailures > 0, window.length, state.lastChangedAt ?? 0, Date.now())
          : LIST_RETRY_MS);
      await target.client.mutation(api.sync.state.finish, {
        secret: target.secret,
        season,
        nextCheckAt: nextDueAt,
        changed,
        wide,
        rankSynced,
        eventsChecked: window.length,
        readFailures,
      });
    };

    const finishQuiet = async (tokens: FreshnessToken[]): Promise<RefreshSummary> => {
      await saveTokens(tokens);
      await finish(false, false);
      return {
        changed: false,
        newEvents: 0,
        updatedEvents: 0,
        newMatches: 0,
        windowSize: window.length,
        skipped304: probes.skipped304,
        wrote: null,
        rankSynced: false,
        ms: Date.now() - t0,
      };
    };

    if (probes.updates.length === 0 && !rankSyncDue) return await finishQuiet(probes.tokens);

    // Worker state: memory-first; re-fetched from Convex file storage only when
    // the committed file is newer than our copy. A 2MB download, hence the gate.
    // Saved state that can't be read throws here; null means none was ever saved.
    const worker = await loadWorkerState(season, {
      target,
      staleIfSavedBefore: state.workerStateSavedAt,
    });
    const current = worker?.events ?? [];

    const delta = await fetchDeltas(season, current, probes, deadline, opts.full === true);
    readFailures += delta.unbuilt;
    // With nothing played and no saved state, a manual full run has nothing to save yet.
    if (!delta.changed && (!rankSyncDue || !worker)) return await finishQuiet(delta.tokens);

    // Recompute the whole season (cheap, ~1-2s), then persist only the delta.
    const computed = computeSeasonData(season, delta.events);
    const { docs, fingerprints } = buildSiteDocs(computed);
    const prevFp = opts.full ? null : (worker?.fingerprints ?? null);
    // With nothing to diff against, every row is new and needs its ranks written.
    const mode = rankSyncDue || !prevFp ? "full" : "stats";
    const diff = diffFingerprints(fingerprints, prevFp, mode);
    const nextFp = fingerprintsAfterPush(fingerprints, prevFp, diff, mode);

    let wrote: PushCounts;
    try {
      wrote = await pushSiteDocs(target, docs, diff, { keepRanks: mode === "stats" });
    } catch (e) {
      // A failed batch may have landed partially: drop the attempted keys from
      // the fingerprint map so the next sync rewrites them. Keeping the OLD events
      // means that sync sees the same change again and gets that far (self-healing).
      // A season's first push has no state to protect: saving one would only end its
      // long sweeps, and the next run rewrites every row anyway.
      if (worker) {
        await saveWorkerState(
          season,
          {
            savedAt: Date.now(),
            events: current,
            fingerprints: invalidateKeys(nextFp, diff),
          },
          target,
          { expectedSavedAt: state.workerStateSavedAt ?? 0 },
        );
      }
      throw e;
    }

    await saveWorkerState(
      season,
      { savedAt: Date.now(), events: delta.events, fingerprints: nextFp },
      target,
      { expectedSavedAt: state.workerStateSavedAt ?? 0, changed: delta.changed },
    );
    await saveTokens(delta.tokens);
    await finish(delta.changed, mode === "full");

    return {
      changed: true,
      newEvents: delta.newEvents.length,
      updatedEvents: delta.updatedEvents.length,
      newMatches: delta.newMatches,
      windowSize: window.length,
      skipped304: probes.skipped304,
      wrote,
      rankSynced: mode === "full",
      ms: Date.now() - t0,
    };
  } finally {
    inFlight = false;
  }
}
