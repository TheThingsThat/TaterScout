// Bundle queries for the two hottest pages — one function call returns
// everything the page needs, deduping the seasonMeta read.
import { query } from "../_generated/server";
import { v } from "convex/values";

/** Team page: meta + leaderboard row + trajectory (≤ ~10KB total). */
export const teamBundle = query({
  args: { season: v.number(), team: v.number() },
  handler: async (ctx, { season, team }) => {
    const [meta, row, trajectory] = await Promise.all([
      ctx.db.query("seasonMeta").withIndex("by_season", (q) => q.eq("season", season)).unique(),
      ctx.db
        .query("seasonTeams")
        .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", team))
        .unique(),
      ctx.db
        .query("seasonTrajectories")
        .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", team))
        .unique(),
    ]);
    return { meta, row, trajectory };
  },
});

/** Event page: meta + rows for the event's roster + as-of-event stats (≤ ~25KB). */
export const eventBundle = query({
  args: { season: v.number(), code: v.string(), teams: v.array(v.number()) },
  handler: async (ctx, { season, code, teams }) => {
    if (teams.length > 250) throw new Error("Too many teams (max 250).");
    const [meta, eventStats] = await Promise.all([
      ctx.db.query("seasonMeta").withIndex("by_season", (q) => q.eq("season", season)).unique(),
      ctx.db
        .query("seasonEventStats")
        .withIndex("by_season_code", (q) => q.eq("season", season).eq("code", code))
        .unique(),
    ]);
    const rows = [];
    for (const t of teams) {
      const doc = await ctx.db
        .query("seasonTeams")
        .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", t))
        .unique();
      if (doc) rows.push(doc);
    }
    return { meta, rows, eventStats };
  },
});
