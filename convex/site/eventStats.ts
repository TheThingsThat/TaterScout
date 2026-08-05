// Per-event time-aware ratings (as-of-event EPA/OPR), one small doc per event.
import { query } from "../_generated/server";
import { v } from "convex/values";

export const byEvent = query({
  args: { season: v.number(), code: v.string() },
  handler: async (ctx, { season, code }) => {
    return await ctx.db
      .query("seasonEventStats")
      .withIndex("by_season_code", (q) => q.eq("season", season).eq("code", code))
      .unique();
  },
});
