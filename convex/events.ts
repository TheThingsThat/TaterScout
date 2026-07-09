import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./lib";

const nn = v.union(v.number(), v.null());

/** Replace the workspace's imported teams + schedule (admin only). The FIRST
 *  fetch + predicted times + EPA/OPR are computed in the Next.js route; this
 *  just persists the snapshot. */
export const importSnapshot = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    teams: v.array(
      v.object({
        teamNumber: v.number(),
        name: v.string(),
        region: v.union(v.string(), v.null()),
        rank: nn,
        epa: nn,
        oprNp: nn,
        oprAuto: nn,
        oprTele: nn,
      }),
    ),
    matches: v.array(
      v.object({
        matchNumber: v.number(),
        red: v.array(v.number()),
        blue: v.array(v.number()),
        predictedTime: nn,
        actualStartTime: v.optional(nn),
        redScore: v.optional(nn),
        blueScore: v.optional(nn),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.workspaceId);

    // Clear existing snapshot for this workspace.
    for (const table of ["teamEvents", "matches"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }

    for (const t of args.teams) {
      await ctx.db.insert("teamEvents", { workspaceId: args.workspaceId, ...t });
    }
    for (const m of args.matches) {
      await ctx.db.insert("matches", { workspaceId: args.workspaceId, ...m });
    }
    return { teams: args.teams.length, matches: args.matches.length };
  },
});
