// Batched upserts for the season tables. Called only by the sync worker /
// seed script with the shared secret; each call is one transaction, sized well
// under Convex's per-mutation limits. The worker sends ONLY changed rows
// (fingerprint diff on its side), so a quiet sync writes nothing.
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireSyncSecret } from "./lib";

const nn = v.union(v.number(), v.null());

const teamRow = v.object({
  team: v.number(),
  numberStr: v.string(),
  name: v.string(),
  region: v.union(v.string(), v.null()),
  n: v.number(),
  epa: nn,
  epaAuto: nn,
  epaTele: nn,
  oprNp: nn,
  oprAuto: nn,
  oprTele: nn,
  rkEpa: nn,
  rkEpaAuto: nn,
  rkEpaTele: nn,
  rkOprNp: nn,
  rkOprAuto: nn,
  rkOprTele: nn,
});

const trajectoryRow = v.object({
  team: v.number(),
  t0: v.number(),
  events: v.array(
    v.object({ c: v.string(), n: v.union(v.string(), v.null()), s: v.union(v.string(), v.null()) }),
  ),
  points: v.array(v.array(nn)),
});

const eventStatsRow = v.object({
  code: v.string(),
  rows: v.record(v.string(), v.array(nn)),
});

const eventRow = v.object({
  code: v.string(),
  name: v.union(v.string(), v.null()),
  searchText: v.string(),
  start: v.union(v.string(), v.null()),
  type: v.string(),
  city: v.union(v.string(), v.null()),
  state: v.union(v.string(), v.null()),
  country: v.union(v.string(), v.null()),
});

function checkBatch(len: number, max: number): void {
  if (len > max) throw new Error(`Batch too large (${len} > ${max}).`);
}

export const upsertTeams = mutation({
  args: { secret: v.string(), season: v.number(), rows: v.array(teamRow) },
  handler: async (ctx, { secret, season, rows }) => {
    requireSyncSecret(secret);
    checkBatch(rows.length, 400);
    for (const row of rows) {
      const doc = await ctx.db
        .query("seasonTeams")
        .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", row.team))
        .unique();
      if (doc) await ctx.db.replace(doc._id, { season, ...row });
      else await ctx.db.insert("seasonTeams", { season, ...row });
    }
    return rows.length;
  },
});

export const upsertTrajectories = mutation({
  args: { secret: v.string(), season: v.number(), rows: v.array(trajectoryRow) },
  handler: async (ctx, { secret, season, rows }) => {
    requireSyncSecret(secret);
    checkBatch(rows.length, 150);
    for (const row of rows) {
      const doc = await ctx.db
        .query("seasonTrajectories")
        .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", row.team))
        .unique();
      if (doc) await ctx.db.replace(doc._id, { season, ...row });
      else await ctx.db.insert("seasonTrajectories", { season, ...row });
    }
    return rows.length;
  },
});

export const upsertEventStats = mutation({
  args: { secret: v.string(), season: v.number(), rows: v.array(eventStatsRow) },
  handler: async (ctx, { secret, season, rows }) => {
    requireSyncSecret(secret);
    checkBatch(rows.length, 300);
    for (const row of rows) {
      const doc = await ctx.db
        .query("seasonEventStats")
        .withIndex("by_season_code", (q) => q.eq("season", season).eq("code", row.code))
        .unique();
      if (doc) await ctx.db.replace(doc._id, { season, ...row });
      else await ctx.db.insert("seasonEventStats", { season, ...row });
    }
    return rows.length;
  },
});

export const upsertEvents = mutation({
  args: { secret: v.string(), season: v.number(), rows: v.array(eventRow) },
  handler: async (ctx, { secret, season, rows }) => {
    requireSyncSecret(secret);
    checkBatch(rows.length, 400);
    for (const row of rows) {
      const doc = await ctx.db
        .query("seasonEvents")
        .withIndex("by_season_code", (q) => q.eq("season", season).eq("code", row.code))
        .unique();
      if (doc) await ctx.db.replace(doc._id, { season, ...row });
      else await ctx.db.insert("seasonEvents", { season, ...row });
    }
    return rows.length;
  },
});

export const putMeta = mutation({
  args: {
    secret: v.string(),
    season: v.number(),
    meta: v.object({
      computedAt: v.string(),
      matchCount: v.number(),
      teamCount: v.number(),
      regions: v.array(v.string()),
      regionCounts: v.record(v.string(), v.number()),
      sortCounts: v.record(v.string(), v.number()),
      cyclePriors: v.union(
        v.null(),
        v.object({
          overallSec: v.number(),
          byTypeSec: v.record(v.string(), v.number()),
          sampleCount: v.number(),
        }),
      ),
      simModel: v.union(v.null(), v.any()),
      worldRecord: v.union(
        v.null(),
        v.object({
          eventCode: v.string(),
          eventName: v.union(v.string(), v.null()),
          eventStart: v.union(v.string(), v.null()),
          score: v.number(),
          teams: v.array(v.object({ number: v.number(), name: v.string() })),
        }),
      ),
    }),
  },
  handler: async (ctx, { secret, season, meta }) => {
    requireSyncSecret(secret);
    const doc = await ctx.db
      .query("seasonMeta")
      .withIndex("by_season", (q) => q.eq("season", season))
      .unique();
    if (doc) await ctx.db.replace(doc._id, { season, ...meta });
    else await ctx.db.insert("seasonMeta", { season, ...meta });
  },
});

/** Remove rows that disappeared from the recompute (rare: scrubbed events). */
export const deleteKeys = mutation({
  args: {
    secret: v.string(),
    season: v.number(),
    kind: v.union(
      v.literal("teams"),
      v.literal("trajectories"),
      v.literal("eventStats"),
      v.literal("events"),
    ),
    teams: v.optional(v.array(v.number())),
    codes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { secret, season, kind, teams, codes }) => {
    requireSyncSecret(secret);
    checkBatch((teams?.length ?? 0) + (codes?.length ?? 0), 400);
    if (kind === "teams" || kind === "trajectories") {
      const table = kind === "teams" ? ("seasonTeams" as const) : ("seasonTrajectories" as const);
      for (const team of teams ?? []) {
        const doc = await ctx.db
          .query(table)
          .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", team))
          .unique();
        if (doc) await ctx.db.delete(doc._id);
      }
    } else {
      const table = kind === "eventStats" ? ("seasonEventStats" as const) : ("seasonEvents" as const);
      for (const code of codes ?? []) {
        const doc = await ctx.db
          .query(table)
          .withIndex("by_season_code", (q) => q.eq("season", season).eq("code", code))
          .unique();
        if (doc) await ctx.db.delete(doc._id);
      }
    }
  },
});
