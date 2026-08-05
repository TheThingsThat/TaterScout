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

/** Current sync state (public: feeds /api/status's "updated Xs ago"). */
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
 *  instance already holds it (nextCheckAt is in the future). */
export const claim = mutation({
  args: {
    secret: v.string(),
    season: v.number(),
    holdMs: v.number(),
    // Manual refreshes bypass the cadence gate (still one atomic writer).
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { secret, season, holdMs, force }) => {
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
    if (doc) {
      await ctx.db.patch(doc._id, { nextCheckAt: now + hold });
      return { claimed: true as const, state: { ...doc, nextCheckAt: now + hold } };
    }
    const id = await ctx.db.insert("syncMeta", { season, ...DEFAULTS, nextCheckAt: now + hold });
    const fresh = await ctx.db.get(id);
    return { claimed: true as const, state: fresh! };
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
  },
  handler: async (ctx, { secret, season, nextCheckAt, changed, wide, rankSynced }) => {
    requireSyncSecret(secret);
    const now = Date.now();
    const doc = await ctx.db
      .query("syncMeta")
      .withIndex("by_season", (q) => q.eq("season", season))
      .unique();
    const patch = {
      lastSyncAt: now,
      nextCheckAt,
      ...(wide ? { lastWideAt: now } : {}),
      ...(rankSynced ? { lastRankSyncAt: now } : {}),
      ...(changed ? { lastChangedAt: now } : {}),
    };
    if (doc) await ctx.db.patch(doc._id, patch);
    else await ctx.db.insert("syncMeta", { season, ...DEFAULTS, ...patch });
  },
});

/** Freshness tokens for a set of FIRST API paths (worker-only usefulness, but
 *  the values are harmless Last-Modified strings). ≤200 paths per call. */
export const freshness = query({
  args: { season: v.number(), paths: v.array(v.string()) },
  handler: async (ctx, { season, paths }) => {
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
