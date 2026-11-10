// Per-team trajectory point reads. Deliberately the ONLY way to reach
// trajectory data — no bulk query exists, so the old 7MB-on-every-request
// pattern is structurally impossible (the Statbotics lesson).
import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireSyncSecret } from "../sync/lib";

export const byTeam = query({
  args: { secret: v.string(), season: v.number(), team: v.number() },
  handler: async (ctx, { secret, season, team }) => {
    requireSyncSecret(secret);
    return await ctx.db
      .query("seasonTrajectories")
      .withIndex("by_season_team", (q) => q.eq("season", season).eq("team", team))
      .unique();
  },
});
