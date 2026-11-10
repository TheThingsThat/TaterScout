// Per-event time-aware ratings (as-of-event EPA/OPR), one small doc per event.
import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireSyncSecret } from "../sync/lib";

export const byEvent = query({
  args: { secret: v.string(), season: v.number(), code: v.string() },
  handler: async (ctx, { secret, season, code }) => {
    requireSyncSecret(secret);
    return await ctx.db
      .query("seasonEventStats")
      .withIndex("by_season_code", (q) => q.eq("season", season).eq("code", code))
      .unique();
  },
});
