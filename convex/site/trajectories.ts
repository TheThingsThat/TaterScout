// Per-team trajectory point reads. Deliberately the ONLY way to reach
// trajectory data — no bulk query exists, so the old 7MB-on-every-request
// pattern is structurally impossible (the Statbotics lesson).
import { query } from "../_generated/server";
import { v } from "convex/values";

export const byTeam = query({
  args: { season: v.number(), team: v.number() },
  handler: async (ctx, { season, team }) => {
    return await ctx.db
      .query("seasonTrajectories")
      .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", team))
      .unique();
  },
});
