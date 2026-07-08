import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireAdmin } from "./lib";
import type { Id } from "./_generated/dataModel";

const OVERDUE_MS = 5 * 60 * 1000;

/** The caller's own assignments (match + pit), joined with schedule + whether a
 *  report already exists. Used by the Match/Pit pages for non-admin scouts. */
export const mySchedule = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const member = await requireMember(ctx, workspaceId);
    const mine = await ctx.db
      .query("assignments")
      .withIndex("by_workspace_member", (q) =>
        q.eq("workspaceId", workspaceId).eq("memberId", member._id),
      )
      .collect();
    const matches = await ctx.db
      .query("matches")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const byNum = new Map(matches.map((m) => [m.matchNumber, m]));
    const reports = await ctx.db
      .query("matchReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const reported = new Set(reports.map((r) => `${r.matchNumber}:${r.teamNumber}`));
    const pits = await ctx.db
      .query("pitReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const pitDone = new Set(pits.map((p) => p.teamNumber));

    const match = mine
      .filter((a) => a.kind === "match" && a.matchNumber != null)
      .map((a) => {
        const m = byNum.get(a.matchNumber as number);
        return {
          _id: a._id,
          matchNumber: a.matchNumber as number,
          teamNumber: a.teamNumber,
          predictedTime: m?.predictedTime ?? null,
          actualStartTime: m?.actualStartTime ?? null,
          hasReport: reported.has(`${a.matchNumber}:${a.teamNumber}`),
        };
      })
      .sort((x, y) => x.matchNumber - y.matchNumber);
    const pit = mine
      .filter((a) => a.kind === "pit")
      .map((a) => ({ _id: a._id, teamNumber: a.teamNumber, hasReport: pitDone.has(a.teamNumber) }))
      .sort((x, y) => x.teamNumber - y.teamNumber);
    return { match, pit };
  },
});

/** Admin: every match assignment with its scout, schedule time, and overdue flag. */
export const matchBoard = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireAdmin(ctx, workspaceId);
    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
    ).map((m) => ({ _id: m._id, name: m.name, role: m.role }));
    const nameById = new Map(members.map((m) => [m._id, m.name]));
    const assigns = await ctx.db
      .query("assignments")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", "match"))
      .collect();
    const matches = await ctx.db
      .query("matches")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const byNum = new Map(matches.map((m) => [m.matchNumber, m]));
    const reports = await ctx.db
      .query("matchReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const reported = new Set(reports.map((r) => `${r.matchNumber}:${r.teamNumber}`));
    const now = Date.now();

    const rows = assigns
      .map((a) => {
        const m = a.matchNumber != null ? byNum.get(a.matchNumber) : undefined;
        const start = m?.actualStartTime ?? m?.predictedTime ?? null;
        const hasReport = reported.has(`${a.matchNumber}:${a.teamNumber}`);
        return {
          _id: a._id,
          matchNumber: a.matchNumber as number,
          teamNumber: a.teamNumber,
          memberId: a.memberId,
          memberName: nameById.get(a.memberId) ?? "?",
          predictedTime: m?.predictedTime ?? null,
          hasReport,
          overdue: !hasReport && start != null && start + OVERDUE_MS < now,
        };
      })
      .sort((x, y) => x.matchNumber - y.matchNumber || x.teamNumber - y.teamNumber);
    return { members, assignments: rows };
  },
});

/** Admin: every pit assignment with its scout and whether the pit report exists. */
export const pitBoard = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireAdmin(ctx, workspaceId);
    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
    ).map((m) => ({ _id: m._id, name: m.name, role: m.role }));
    const nameById = new Map(members.map((m) => [m._id, m.name]));
    const assigns = await ctx.db
      .query("assignments")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", "pit"))
      .collect();
    const pits = await ctx.db
      .query("pitReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const pitDone = new Set(pits.map((p) => p.teamNumber));
    const rows = assigns
      .map((a) => ({
        _id: a._id,
        teamNumber: a.teamNumber,
        memberId: a.memberId,
        memberName: nameById.get(a.memberId) ?? "?",
        hasReport: pitDone.has(a.teamNumber),
      }))
      .sort((x, y) => x.teamNumber - y.teamNumber);
    return { members, assignments: rows };
  },
});

// Round-robin picker that keeps per-member load balanced.
function pickBalanced(
  memberIds: Id<"members">[],
  load: Map<Id<"members">, number>,
  exclude?: Set<Id<"members">>,
): Id<"members"> {
  const sorted = [...memberIds].sort(
    (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || memberIds.indexOf(a) - memberIds.indexOf(b),
  );
  const pick = (exclude && sorted.find((m) => !exclude.has(m))) || sorted[0];
  load.set(pick, (load.get(pick) ?? 0) + 1);
  return pick;
}

async function validMembers(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  memberIds: Id<"members">[],
): Promise<Id<"members">[]> {
  const rows = await ctx.db
    .query("members")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const ok = new Set(rows.map((m) => m._id));
  return memberIds.filter((id) => ok.has(id));
}

/** Admin: auto-assign every (match, selected-team) slot across the selected
 *  scouts, balanced, avoiding the same scout twice in one match when possible.
 *  Replaces existing match assignments for the selected teams. */
export const autoAssignMatches = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    teamNumbers: v.array(v.number()),
    memberIds: v.array(v.id("members")),
  },
  handler: async (ctx, { workspaceId, teamNumbers, memberIds }) => {
    await requireAdmin(ctx, workspaceId);
    const members = await validMembers(ctx, workspaceId, memberIds);
    if (members.length === 0) throw new Error("Select at least one scout.");
    if (teamNumbers.length === 0) throw new Error("Select at least one team.");
    const teamSet = new Set(teamNumbers);

    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", "match"))
      .collect();
    for (const a of existing) if (teamSet.has(a.teamNumber)) await ctx.db.delete(a._id);

    const load = new Map<Id<"members">, number>();
    for (const id of members) load.set(id, 0);
    for (const a of existing)
      if (!teamSet.has(a.teamNumber) && load.has(a.memberId))
        load.set(a.memberId, (load.get(a.memberId) ?? 0) + 1);

    const matches = (
      await ctx.db
        .query("matches")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
    ).sort((a, b) => a.matchNumber - b.matchNumber);

    let assigned = 0;
    for (const m of matches) {
      const teamsIn = [...m.red, ...m.blue].filter((t) => teamSet.has(t));
      const usedThisMatch = new Set<Id<"members">>();
      for (const team of teamsIn) {
        const pick = pickBalanced(members, load, usedThisMatch);
        usedThisMatch.add(pick);
        await ctx.db.insert("assignments", {
          workspaceId,
          kind: "match",
          memberId: pick,
          teamNumber: team,
          matchNumber: m.matchNumber,
        });
        assigned++;
      }
    }
    return { assigned };
  },
});

/** Admin: auto-assign the selected teams' pit scouting across selected scouts. */
export const autoAssignPits = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    teamNumbers: v.array(v.number()),
    memberIds: v.array(v.id("members")),
  },
  handler: async (ctx, { workspaceId, teamNumbers, memberIds }) => {
    await requireAdmin(ctx, workspaceId);
    const members = await validMembers(ctx, workspaceId, memberIds);
    if (members.length === 0) throw new Error("Select at least one scout.");
    if (teamNumbers.length === 0) throw new Error("Select at least one team.");
    const teamSet = new Set(teamNumbers);

    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", "pit"))
      .collect();
    for (const a of existing) if (teamSet.has(a.teamNumber)) await ctx.db.delete(a._id);

    const load = new Map<Id<"members">, number>();
    for (const id of members) load.set(id, 0);
    for (const a of existing)
      if (!teamSet.has(a.teamNumber) && load.has(a.memberId))
        load.set(a.memberId, (load.get(a.memberId) ?? 0) + 1);

    let assigned = 0;
    for (const team of [...teamNumbers].sort((a, b) => a - b)) {
      const pick = pickBalanced(members, load);
      await ctx.db.insert("assignments", { workspaceId, kind: "pit", memberId: pick, teamNumber: team });
      assigned++;
    }
    return { assigned };
  },
});

/** Admin: move one assignment to another scout (drag-to-reassign). */
export const reassign = mutation({
  args: { assignmentId: v.id("assignments"), toMemberId: v.id("members") },
  handler: async (ctx, { assignmentId, toMemberId }) => {
    const a = await ctx.db.get(assignmentId);
    if (!a) throw new Error("Assignment not found.");
    await requireAdmin(ctx, a.workspaceId);
    const target = await ctx.db.get(toMemberId);
    if (!target || target.workspaceId !== a.workspaceId) throw new Error("Member not in workspace.");
    await ctx.db.patch(assignmentId, { memberId: toMemberId });
  },
});

/** Admin: delete a single assignment. */
export const unassign = mutation({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }) => {
    const a = await ctx.db.get(assignmentId);
    if (!a) return;
    await requireAdmin(ctx, a.workspaceId);
    await ctx.db.delete(assignmentId);
  },
});
