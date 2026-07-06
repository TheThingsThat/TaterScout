import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMember } from "./lib";

/** Qual schedule for the workspace's event. */
export const schedule = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    return (
      await ctx.db
        .query("matches")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
    ).sort((a, b) => a.matchNumber - b.matchNumber);
  },
});

/** Live claim + report state for a match (who's on which robot). */
export const matchState = query({
  args: { workspaceId: v.id("workspaces"), matchNumber: v.number() },
  handler: async (ctx, { workspaceId, matchNumber }) => {
    await requireMember(ctx, workspaceId);
    const claims = await ctx.db
      .query("matchClaims")
      .withIndex("by_workspace_match_team", (q) =>
        q.eq("workspaceId", workspaceId).eq("matchNumber", matchNumber),
      )
      .collect();
    const reports = await ctx.db
      .query("matchReports")
      .withIndex("by_workspace_match", (q) =>
        q.eq("workspaceId", workspaceId).eq("matchNumber", matchNumber),
      )
      .collect();
    const claimers = new Map<string, string>(); // memberId -> name
    for (const c of claims) {
      const m = await ctx.db.get(c.memberId);
      if (m) claimers.set(c.memberId, m.name);
    }
    return {
      claims: claims.map((c) => ({
        teamNumber: c.teamNumber,
        memberId: c.memberId,
        by: claimers.get(c.memberId) ?? "?",
      })),
      reportedTeams: reports.map((r) => r.teamNumber),
    };
  },
});

/** Claim a robot in a match (one scout per robot). Fails if taken/reported. */
export const claim = mutation({
  args: { workspaceId: v.id("workspaces"), matchNumber: v.number(), teamNumber: v.number() },
  handler: async (ctx, { workspaceId, matchNumber, teamNumber }) => {
    const member = await requireMember(ctx, workspaceId);
    const existing = await ctx.db
      .query("matchClaims")
      .withIndex("by_workspace_match_team", (q) =>
        q.eq("workspaceId", workspaceId).eq("matchNumber", matchNumber).eq("teamNumber", teamNumber),
      )
      .unique();
    if (existing) {
      if (existing.memberId === member._id) return existing._id;
      throw new Error("Already claimed by another scout.");
    }
    const reports = await ctx.db
      .query("matchReports")
      .withIndex("by_workspace_match", (q) =>
        q.eq("workspaceId", workspaceId).eq("matchNumber", matchNumber),
      )
      .collect();
    if (reports.some((r) => r.teamNumber === teamNumber)) {
      throw new Error("Already scouted for this match.");
    }
    return ctx.db.insert("matchClaims", { workspaceId, matchNumber, teamNumber, memberId: member._id });
  },
});

export const unclaim = mutation({
  args: { workspaceId: v.id("workspaces"), matchNumber: v.number(), teamNumber: v.number() },
  handler: async (ctx, { workspaceId, matchNumber, teamNumber }) => {
    const member = await requireMember(ctx, workspaceId);
    const existing = await ctx.db
      .query("matchClaims")
      .withIndex("by_workspace_match_team", (q) =>
        q.eq("workspaceId", workspaceId).eq("matchNumber", matchNumber).eq("teamNumber", teamNumber),
      )
      .unique();
    if (existing && existing.memberId === member._id) await ctx.db.delete(existing._id);
  },
});

/** Submit a match report (one per robot per match). Frees the claim. */
export const submitReport = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    matchNumber: v.number(),
    teamNumber: v.number(),
    autoNearZone: v.boolean(),
    autoFarZone: v.boolean(),
    autoLeave: v.boolean(),
    autoUndisrupted: v.boolean(),
    autoArtifacts: v.number(),
    teleopNearZone: v.boolean(),
    teleopFarZone: v.boolean(),
    teleopArtifacts: v.number(),
    park: v.union(v.literal("none"), v.literal("simple"), v.literal("tilt"), v.literal("climb")),
    malfunctions: v.array(v.string()),
    malfunctionNote: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx, args.workspaceId);
    const reports = await ctx.db
      .query("matchReports")
      .withIndex("by_workspace_match", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("matchNumber", args.matchNumber),
      )
      .collect();
    if (reports.some((r) => r.teamNumber === args.teamNumber)) {
      throw new Error("A report already exists for this robot in this match.");
    }
    const { workspaceId, ...rest } = args;
    const id = await ctx.db.insert("matchReports", {
      workspaceId,
      memberId: member._id,
      createdAt: Date.now(),
      ...rest,
    });
    // Free the claim now that the report exists.
    const claim = await ctx.db
      .query("matchClaims")
      .withIndex("by_workspace_match_team", (q) =>
        q.eq("workspaceId", workspaceId).eq("matchNumber", args.matchNumber).eq("teamNumber", args.teamNumber),
      )
      .unique();
    if (claim) await ctx.db.delete(claim._id);
    return id;
  },
});
