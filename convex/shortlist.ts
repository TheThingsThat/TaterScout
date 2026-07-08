import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMember } from "./lib";

/** The caller's private shortlist, ordered, joined with team names. */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const member = await requireMember(ctx, workspaceId);
    const entries = (
      await ctx.db
        .query("shortlist")
        .withIndex("by_workspace_member", (q) =>
          q.eq("workspaceId", workspaceId).eq("memberId", member._id),
        )
        .collect()
    ).sort((a, b) => a.rank - b.rank);
    const teams = await ctx.db
      .query("teamEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const byTeam = new Map(teams.map((t) => [t.teamNumber, t]));
    return entries.map((e) => {
      const t = byTeam.get(e.teamNumber);
      return {
        _id: e._id,
        teamNumber: e.teamNumber,
        rank: e.rank,
        name: t?.name ?? `Team ${e.teamNumber}`,
        epa: t?.epa ?? null,
        oprNp: t?.oprNp ?? null,
      };
    });
  },
});

/** Add a team to the caller's shortlist (idempotent), at the end. */
export const add = mutation({
  args: { workspaceId: v.id("workspaces"), teamNumber: v.number() },
  handler: async (ctx, { workspaceId, teamNumber }) => {
    const member = await requireMember(ctx, workspaceId);
    const existing = await ctx.db
      .query("shortlist")
      .withIndex("by_workspace_member", (q) =>
        q.eq("workspaceId", workspaceId).eq("memberId", member._id),
      )
      .collect();
    if (existing.some((e) => e.teamNumber === teamNumber)) return;
    const maxRank = existing.reduce((m, e) => Math.max(m, e.rank), -1);
    await ctx.db.insert("shortlist", {
      workspaceId,
      memberId: member._id,
      teamNumber,
      rank: maxRank + 1,
    });
  },
});

/** Remove one of the caller's shortlist entries. */
export const remove = mutation({
  args: { entryId: v.id("shortlist") },
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry) return;
    const member = await requireMember(ctx, entry.workspaceId);
    if (entry.memberId !== member._id) throw new Error("Not your shortlist.");
    await ctx.db.delete(entryId);
  },
});

/** Reorder an entry to a target index (fractional rank between neighbours). */
export const move = mutation({
  args: { entryId: v.id("shortlist"), toIndex: v.number() },
  handler: async (ctx, { entryId, toIndex }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry) throw new Error("Entry not found.");
    const member = await requireMember(ctx, entry.workspaceId);
    if (entry.memberId !== member._id) throw new Error("Not your shortlist.");
    const others = (
      await ctx.db
        .query("shortlist")
        .withIndex("by_workspace_member", (q) =>
          q.eq("workspaceId", entry.workspaceId).eq("memberId", member._id),
        )
        .collect()
    )
      .filter((e) => e._id !== entryId)
      .sort((a, b) => a.rank - b.rank);
    const before = others[toIndex - 1]?.rank;
    const after = others[toIndex]?.rank;
    let rank: number;
    if (before == null && after == null) rank = 0;
    else if (before == null) rank = (after as number) - 1;
    else if (after == null) rank = before + 1;
    else rank = (before + after) / 2;
    await ctx.db.patch(entryId, { rank });
  },
});
