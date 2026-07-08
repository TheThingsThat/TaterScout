import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./lib";

/** All members of a workspace with email, role, and how many reports each has
 *  submitted vs. been assigned (match + pit). Admin only. */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireAdmin(ctx, workspaceId);
    const members = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const matchReports = await ctx.db
      .query("matchReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const pitReports = await ctx.db
      .query("pitReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    const count = <T extends { memberId: unknown }>(rows: T[], id: unknown) =>
      rows.filter((r) => r.memberId === id).length;

    const out = [];
    for (const m of members) {
      const user = await ctx.db.get(m.userId);
      const matchAssigned = assignments.filter((a) => a.kind === "match" && a.memberId === m._id).length;
      const pitAssigned = assignments.filter((a) => a.kind === "pit" && a.memberId === m._id).length;
      out.push({
        _id: m._id,
        name: m.name,
        email: user?.email ?? null,
        role: m.role,
        matchSubmitted: count(matchReports, m._id),
        matchAssigned,
        pitSubmitted: count(pitReports, m._id),
        pitAssigned,
      });
    }
    // Admins first, then by name.
    return out.sort(
      (a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1),
    );
  },
});

/** Promote/demote a member. Guards against demoting the last admin. */
export const setRole = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    memberId: v.id("members"),
    role: v.union(v.literal("admin"), v.literal("scout")),
  },
  handler: async (ctx, { workspaceId, memberId, role }) => {
    await requireAdmin(ctx, workspaceId);
    const target = await ctx.db.get(memberId);
    if (!target || target.workspaceId !== workspaceId) throw new Error("Member not found.");
    if (role === "scout" && target.role === "admin") {
      const admins = (
        await ctx.db
          .query("members")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
      ).filter((m) => m.role === "admin");
      if (admins.length <= 1) throw new Error("Can't demote the only admin.");
    }
    await ctx.db.patch(memberId, { role });
  },
});

/** Remove a member: deletes their assignments/claims/shortlist; keeps reports. */
export const remove = mutation({
  args: { workspaceId: v.id("workspaces"), memberId: v.id("members") },
  handler: async (ctx, { workspaceId, memberId }) => {
    await requireAdmin(ctx, workspaceId);
    const target = await ctx.db.get(memberId);
    if (!target || target.workspaceId !== workspaceId) throw new Error("Member not found.");
    if (target.role === "admin") {
      const admins = (
        await ctx.db
          .query("members")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
      ).filter((m) => m.role === "admin");
      if (admins.length <= 1) throw new Error("Can't remove the only admin.");
    }
    const assigns = await ctx.db
      .query("assignments")
      .withIndex("by_workspace_member", (q) =>
        q.eq("workspaceId", workspaceId).eq("memberId", memberId),
      )
      .collect();
    const claims = await ctx.db
      .query("matchClaims")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .collect();
    const shorts = await ctx.db
      .query("shortlist")
      .withIndex("by_workspace_member", (q) =>
        q.eq("workspaceId", workspaceId).eq("memberId", memberId),
      )
      .collect();
    for (const r of [...assigns, ...claims, ...shorts]) await ctx.db.delete(r._id);
    await ctx.db.delete(memberId);
  },
});
