import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember } from "./lib";

/** Team list for the event: imported stats + match-report count + pit status. */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const teams = await ctx.db
      .query("teamEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const reports = await ctx.db
      .query("matchReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const reportCount = new Map<number, number>();
    for (const r of reports) reportCount.set(r.teamNumber, (reportCount.get(r.teamNumber) ?? 0) + 1);

    const pits = await ctx.db
      .query("pitReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const pitByTeam = new Map(pits.map((p) => [p.teamNumber, p]));

    return teams
      .map((t) => ({
        ...t,
        reportCount: reportCount.get(t.teamNumber) ?? 0,
        pitScouted: pitByTeam.has(t.teamNumber),
        robotStatus: pitByTeam.get(t.teamNumber)?.robotStatus ?? null,
      }))
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.teamNumber - b.teamNumber);
  },
});

/** One team: imported stats, all match reports, and simple averages. */
export const detail = query({
  args: { workspaceId: v.id("workspaces"), teamNumber: v.number() },
  handler: async (ctx, { workspaceId, teamNumber }) => {
    await requireMember(ctx, workspaceId);
    const team = await ctx.db
      .query("teamEvents")
      .withIndex("by_workspace_team", (q) =>
        q.eq("workspaceId", workspaceId).eq("teamNumber", teamNumber),
      )
      .unique();
    const pit = await ctx.db
      .query("pitReports")
      .withIndex("by_workspace_team", (q) =>
        q.eq("workspaceId", workspaceId).eq("teamNumber", teamNumber),
      )
      .unique();
    const reports = (
      await ctx.db
        .query("matchReports")
        .withIndex("by_workspace_team", (q) =>
          q.eq("workspaceId", workspaceId).eq("teamNumber", teamNumber),
        )
        .collect()
    ).sort((a, b) => a.matchNumber - b.matchNumber);

    const n = reports.length;
    const mean = (f: (r: (typeof reports)[number]) => number) =>
      n ? reports.reduce((s, r) => s + f(r), 0) / n : 0;
    const autoZoneDist: Record<string, number> = { far: 0, near: 0, none: 0 };
    const teleopZoneDist: Record<string, number> = { far: 0, near: 0, none: 0 };
    const endgameDist: Record<string, number> = { park: 0, tilt: 0, climb: 0, none: 0 };
    const tagFreq: Record<string, number> = {};
    for (const r of reports) {
      autoZoneDist[r.autoZone] = (autoZoneDist[r.autoZone] ?? 0) + 1;
      teleopZoneDist[r.teleopZone] = (teleopZoneDist[r.teleopZone] ?? 0) + 1;
      endgameDist[r.endgame] = (endgameDist[r.endgame] ?? 0) + 1;
      for (const tag of r.tags) tagFreq[tag] = (tagFreq[tag] ?? 0) + 1;
    }

    return {
      team,
      pit,
      reports,
      averages: n
        ? {
            count: n,
            autoArtifacts: mean((r) => r.autoArtifacts),
            teleopArtifacts: mean((r) => r.teleopArtifacts),
            autoZoneDist,
            teleopZoneDist,
            endgameDist,
            tagFreq,
          }
        : null,
    };
  },
});
