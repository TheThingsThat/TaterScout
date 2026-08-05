// Public season queries for the analytics site. All reads are index-bounded
// point/range reads — no unbounded collects. Data is public; no auth.
import { query } from "../_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";

export const sortKey = v.union(
  v.literal("epa"),
  v.literal("epaAuto"),
  v.literal("epaTele"),
  v.literal("oprNp"),
  v.literal("oprAuto"),
  v.literal("oprTele"),
);
type SortKey = "epa" | "epaAuto" | "epaTele" | "oprNp" | "oprAuto" | "oprTele";

/** The season's small metadata doc (counts, regions, priors, sim, record). */
export const meta = query({
  args: { season: v.number() },
  handler: async (ctx, { season }) => {
    return await ctx.db
      .query("seasonMeta")
      .withIndex("by_season", (q) => q.eq("season", season))
      .unique();
  },
});

// Rank-range read on the sort key's dedicated index (dense ranks double as
// offset pagination, which Convex doesn't have natively).
function rankRange(ctx: QueryCtx, season: number, sort: SortKey, lo: number, hi: number, order: "asc" | "desc") {
  const base = ctx.db.query("seasonTeams");
  const lo1 = Math.max(1, lo);
  switch (sort) {
    case "epa":
      return base.withIndex("by_season_rkEpa", (q) => q.eq("season", season).gte("rkEpa", lo1).lte("rkEpa", hi)).order(order);
    case "epaAuto":
      return base.withIndex("by_season_rkEpaAuto", (q) => q.eq("season", season).gte("rkEpaAuto", lo1).lte("rkEpaAuto", hi)).order(order);
    case "epaTele":
      return base.withIndex("by_season_rkEpaTele", (q) => q.eq("season", season).gte("rkEpaTele", lo1).lte("rkEpaTele", hi)).order(order);
    case "oprNp":
      return base.withIndex("by_season_rkOprNp", (q) => q.eq("season", season).gte("rkOprNp", lo1).lte("rkOprNp", hi)).order(order);
    case "oprAuto":
      return base.withIndex("by_season_rkOprAuto", (q) => q.eq("season", season).gte("rkOprAuto", lo1).lte("rkOprAuto", hi)).order(order);
    case "oprTele":
      return base.withIndex("by_season_rkOprTele", (q) => q.eq("season", season).gte("rkOprTele", lo1).lte("rkOprTele", hi)).order(order);
  }
}

/** One leaderboard page. Global pages read exactly `pageSize` docs via a rank
 *  range; region pages read the whole (small, ≤~650 doc) region and sort in
 *  memory so null-stat teams still appear at the tail like the file backend. */
export const page = query({
  args: {
    season: v.number(),
    sort: sortKey,
    dir: v.union(v.literal("asc"), v.literal("desc")),
    region: v.union(v.string(), v.null()),
    page: v.number(),
    pageSize: v.number(),
  },
  handler: async (ctx, a) => {
    const season = a.season;
    const ps = Math.min(Math.max(Math.floor(a.pageSize), 1), 100);
    const metaDoc = await ctx.db
      .query("seasonMeta")
      .withIndex("by_season", (q) => q.eq("season", season))
      .unique();
    if (!metaDoc) return { rows: [], total: 0, page: 1, pages: 1 };

    if (a.region == null) {
      const total = metaDoc.sortCounts[a.sort] ?? 0;
      const pages = Math.max(1, Math.ceil(total / ps));
      const p = Math.min(Math.max(1, Math.floor(a.page)), pages);
      // desc = best-first = ascending rank; asc = mirrored range from the tail.
      const lo = a.dir === "desc" ? (p - 1) * ps + 1 : total - p * ps + 1;
      const hi = a.dir === "desc" ? p * ps : total - (p - 1) * ps;
      const rows = hi < 1 ? [] : await rankRange(ctx, season, a.sort, lo, hi, a.dir === "desc" ? "asc" : "desc").take(ps);
      return { rows, total, page: p, pages };
    }

    // Region view: eq(season, region) prefix on the region index returns the
    // whole region (including null-stat teams); sort here, nulls last.
    const regionRows = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season_region_rkEpa", (q) => q.eq("season", season).eq("region", a.region))
      .take(1500);
    const key = a.sort;
    const sorted = regionRows.sort((x, y) => {
      const xv = x[key];
      const yv = y[key];
      if (xv == null && yv == null) return x.team - y.team;
      if (xv == null) return 1;
      if (yv == null) return -1;
      return a.dir === "desc" ? yv - xv : xv - yv;
    });
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / ps));
    const p = Math.min(Math.max(1, Math.floor(a.page)), pages);
    return { rows: sorted.slice((p - 1) * ps, p * ps), total, page: p, pages };
  },
});

/** One team's leaderboard row (point read). */
export const team = query({
  args: { season: v.number(), team: v.number() },
  handler: async (ctx, { season, team }) => {
    return await ctx.db
      .query("seasonTeams")
      .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", team))
      .unique();
  },
});

/** Rows for a bounded set of team numbers (event pages, scout import). */
export const teams = query({
  args: { season: v.number(), teams: v.array(v.number()) },
  handler: async (ctx, { season, teams }) => {
    if (teams.length > 250) throw new Error("Too many teams (max 250).");
    const out = [];
    for (const t of teams) {
      const doc = await ctx.db
        .query("seasonTeams")
        .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", t))
        .unique();
      if (doc) out.push(doc);
    }
    return out;
  },
});
