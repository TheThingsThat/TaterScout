// Sync coordination: the syncMeta doc (cadence state) and upstream freshness
// tokens. Replaces the meta-{season} blob; `claim` is a transactional
// compare-and-set, which genuinely fixes the parallel-instance double-sync
// race the blob write could only mitigate.
import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireSyncSecret } from "./lib";

const DEFAULTS = {
  lastSyncAt: 0,
  nextCheckAt: 0,
  lastWideAt: 0,
  lastRankSyncAt: 0,
  lastChangedAt: 0,
};

/** Current sync state, timestamps only (the /status page; `npx convex run sync/state:get`). */
export const get = query({
  args: { season: v.number() },
  handler: async (ctx, { season }) => {
    const doc = await ctx.db
      .query("syncMeta")
      .withIndex("by_season", (q) => q.eq("season", season))
      .unique();
    return doc ?? { season, ...DEFAULTS };
  },
});

/** Atomically claim the next sync slot. Returns claimed=false when another
 *  instance already holds it (nextCheckAt is in the future). Also decides whether
 *  this run sweeps wider, and stamps that here so a run killed mid-sweep waits for
 *  the next interval instead of retrying the same sweep on every claim. */
export const claim = mutation({
  args: {
    secret: v.string(),
    season: v.number(),
    holdMs: v.number(),
    // Manual refreshes bypass the cadence gate (still one atomic writer).
    force: v.optional(v.boolean()),
    wideAfterMs: v.optional(v.number()),
    longAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, { secret, season, holdMs, force, wideAfterMs, longAfterMs }) => {
    requireSyncSecret(secret);
    const now = Date.now();
    const hold = Math.min(Math.max(holdMs, 10_000), 10 * 60_000);
    const doc = await ctx.db
      .query("syncMeta")
      .withIndex("by_season", (q) => q.eq("season", season))
      .unique();
    if (doc && now < doc.nextCheckAt && !force) {
      return { claimed: false as const, state: doc };
    }
    const due = (last: number | undefined, after: number | undefined) =>
      after !== undefined && now - (last ?? 0) > after;
    const long = due(doc?.lastLongSweepAt, longAfterMs);
    const wide = long || due(doc?.lastWideAt, wideAfterMs);
    // The hold has passed (or this is forced), so a run that claimed after the last
    // finish is over without finishing: it threw or was killed.
    const previousUnfinished = (doc?.lastAttemptAt ?? 0) > (doc?.lastSyncAt ?? 0);
    const patch = {
      nextCheckAt: now + hold,
      lastAttemptAt: now,
      failedRuns: (doc?.failedRuns ?? 0) + (previousUnfinished ? 1 : 0),
      ...(wide ? { lastWideAt: now } : {}),
      ...(long ? { lastLongSweepAt: now } : {}),
    };
    if (doc) {
      await ctx.db.patch(doc._id, patch);
      return { claimed: true as const, state: { ...doc, ...patch }, wide, long };
    }
    const id = await ctx.db.insert("syncMeta", { season, ...DEFAULTS, ...patch });
    const fresh = await ctx.db.get(id);
    return { claimed: true as const, state: fresh!, wide, long };
  },
});

/** Record a finished sync and schedule the next check. */
export const finish = mutation({
  args: {
    secret: v.string(),
    season: v.number(),
    nextCheckAt: v.number(),
    changed: v.boolean(),
    wide: v.boolean(),
    rankSynced: v.boolean(),
    // Optional so a site deployed before this change keeps finishing its runs.
    eventsChecked: v.optional(v.number()),
    readFailures: v.optional(v.number()),
  },
  handler: async (ctx, { secret, season, nextCheckAt, changed, wide, rankSynced, eventsChecked, readFailures }) => {
    requireSyncSecret(secret);
    const now = Date.now();
    const doc = await ctx.db
      .query("syncMeta")
      .withIndex("by_season", (q) => q.eq("season", season))
      .unique();
    const patch = {
      lastSyncAt: now,
      nextCheckAt,
      failedRuns: 0,
      lastEventsChecked: eventsChecked ?? 0,
      lastReadFailures: readFailures ?? 0,
      ...(wide ? { lastWideAt: now } : {}),
      ...(rankSynced ? { lastRankSyncAt: now } : {}),
      ...(changed ? { lastChangedAt: now } : {}),
    };
    if (doc) await ctx.db.patch(doc._id, patch);
    else await ctx.db.insert("syncMeta", { season, ...DEFAULTS, ...patch });
  },
});

// --- Worker state file (raw events + fingerprints, gzipped) ---------------
// Convex file storage is the worker's only persistent home: any instance can
// adopt the newest state, and no external blob store is involved.

/** One-shot upload URL for a new worker-state file. */
export const workerStateUploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireSyncSecret(secret);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Point the season at a freshly uploaded state file; delete the old one.
 *  With `expectedSavedAt` this is a compare-and-set: if another run committed
 *  since this one loaded its state, the upload is discarded and false returned. */
export const commitWorkerState = mutation({
  args: {
    secret: v.string(),
    season: v.number(),
    storageId: v.id("_storage"),
    savedAt: v.number(),
    expectedSavedAt: v.optional(v.number()),
    changed: v.optional(v.boolean()),
  },
  handler: async (ctx, { secret, season, storageId, savedAt, expectedSavedAt, changed }) => {
    requireSyncSecret(secret);
    const doc = await ctx.db
      .query("syncMeta")
      .withIndex("by_season", (q) => q.eq("season", season))
      .unique();
    if (expectedSavedAt !== undefined && (doc?.workerStateSavedAt ?? 0) !== expectedSavedAt) {
      await ctx.storage.delete(storageId);
      return false;
    }
    const oldId = doc?.workerStateId;
    if (doc) {
      await ctx.db.patch(doc._id, {
        workerStateId: storageId,
        workerStateSavedAt: savedAt,
        ...(changed ? { lastChangedAt: Date.now() } : {}),
      });
    } else
      await ctx.db.insert("syncMeta", {
        season,
        ...DEFAULTS,
        workerStateId: storageId,
        workerStateSavedAt: savedAt,
      });
    if (oldId && oldId !== storageId) await ctx.storage.delete(oldId);
    return true;
  },
});

/** Drop a season's freshness tokens (in batches; call until it returns 0). Used
 *  when a seed replaces the worker state, so every event gets re-read rather
 *  than trusting tokens recorded against the state that was replaced. */
export const clearFreshness = mutation({
  args: { secret: v.string(), season: v.number() },
  handler: async (ctx, { secret, season }) => {
    requireSyncSecret(secret);
    const batch = await ctx.db
      .query("upstreamFreshness")
      .withIndex("by_season_path", (q) => q.eq("season", season))
      .take(500);
    for (const doc of batch) await ctx.db.delete(doc._id);
    return batch.length;
  },
});

/** Signed download URL for the season's worker state (worker-only data). */
export const workerStateUrl = query({
  args: { secret: v.string(), season: v.number() },
  handler: async (ctx, { secret, season }) => {
    requireSyncSecret(secret);
    const doc = await ctx.db
      .query("syncMeta")
      .withIndex("by_season", (q) => q.eq("season", season))
      .unique();
    if (!doc?.workerStateId) return null;
    const url = await ctx.storage.getUrl(doc.workerStateId);
    return url ? { url, savedAt: doc.workerStateSavedAt ?? 0 } : null;
  },
});

/** Freshness tokens for a set of FIRST API paths. The values are harmless
 *  Last-Modified strings, but 200 reads a call is worth gating. ≤200 paths. */
export const freshness = query({
  args: { secret: v.string(), season: v.number(), paths: v.array(v.string()) },
  handler: async (ctx, { secret, season, paths }) => {
    requireSyncSecret(secret);
    if (paths.length > 200) throw new Error("Too many paths (max 200).");
    const out: Record<string, string> = {};
    for (const path of paths) {
      const doc = await ctx.db
        .query("upstreamFreshness")
        .withIndex("by_season_path", (q) => q.eq("season", season).eq("path", path))
        .unique();
      if (doc) out[path] = doc.lastModified;
    }
    return out;
  },
});

/** Upsert freshness tokens after successful (200) fetches. */
export const putFreshness = mutation({
  args: {
    secret: v.string(),
    season: v.number(),
    tokens: v.array(v.object({ path: v.string(), lastModified: v.string() })),
  },
  handler: async (ctx, { secret, season, tokens }) => {
    requireSyncSecret(secret);
    if (tokens.length > 200) throw new Error("Too many tokens (max 200).");
    const now = Date.now();
    for (const t of tokens) {
      const doc = await ctx.db
        .query("upstreamFreshness")
        .withIndex("by_season_path", (q) => q.eq("season", season).eq("path", t.path))
        .unique();
      if (doc) await ctx.db.patch(doc._id, { lastModified: t.lastModified, checkedAt: now });
      else
        await ctx.db.insert("upstreamFreshness", {
          season,
          path: t.path,
          lastModified: t.lastModified,
          checkedAt: now,
        });
    }
  },
});
