import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMember } from "./lib";

export const get = query({
  args: { workspaceId: v.id("workspaces"), teamNumber: v.number() },
  handler: async (ctx, { workspaceId, teamNumber }) => {
    await requireMember(ctx, workspaceId);
    return await ctx.db
      .query("pitReports")
      .withIndex("by_workspace_team", (q) =>
        q.eq("workspaceId", workspaceId).eq("teamNumber", teamNumber),
      )
      .unique();
  },
});

/** Upsert the pit report for a team (one per team, editable). */
export const upsert = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    teamNumber: v.number(),
    farAuto: v.boolean(),
    farTele: v.boolean(),
    nearAuto: v.boolean(),
    nearTele: v.boolean(),
    canPark: v.boolean(),
    canTilt: v.boolean(),
    canClimb: v.boolean(),
    robotStatus: v.union(v.literal("full"), v.literal("minor"), v.literal("major")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx, args.workspaceId);
    const existing = await ctx.db
      .query("pitReports")
      .withIndex("by_workspace_team", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("teamNumber", args.teamNumber),
      )
      .unique();
    const { workspaceId, teamNumber, ...fields } = args;
    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, memberId: member._id, updatedAt: Date.now() });
      return existing._id;
    }
    return ctx.db.insert("pitReports", {
      workspaceId,
      teamNumber,
      memberId: member._id,
      updatedAt: Date.now(),
      ...fields,
    });
  },
});
