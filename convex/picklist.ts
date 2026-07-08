import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember } from "./lib";

// Argmax over a count map, with a priority order used to break ties.
function dominant(counts: Record<string, number>, priority: string[]): string | null {
  let best: string | null = null;
  let bestN = -1;
  for (const key of priority) {
    const n = counts[key] ?? 0;
    if (n > bestN) {
      bestN = n;
      best = key;
    }
  }
  return bestN > 0 ? best : null;
}

/** Per-team aggregates for the filter/sort ranking view: imported ratings plus
 *  the scouted-label facets (dominant value + raw counts) and pit capability. */
export const teams = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);

    const teamRows = await ctx.db
      .query("teamEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const reports = await ctx.db
      .query("matchReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const pits = await ctx.db
      .query("pitReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const pitByTeam = new Map(pits.map((p) => [p.teamNumber, p]));

    type Agg = {
      count: number;
      auto: Record<string, number>;
      teleop: Record<string, number>;
      endgame: Record<string, number>;
    };
    const agg = new Map<number, Agg>();
    for (const r of reports) {
      let a = agg.get(r.teamNumber);
      if (!a) {
        a = { count: 0, auto: {}, teleop: {}, endgame: {} };
        agg.set(r.teamNumber, a);
      }
      a.count++;
      a.auto[r.autoZone] = (a.auto[r.autoZone] ?? 0) + 1;
      a.teleop[r.teleopZone] = (a.teleop[r.teleopZone] ?? 0) + 1;
      a.endgame[r.endgame] = (a.endgame[r.endgame] ?? 0) + 1;
    }

    return teamRows.map((t) => {
      const a = agg.get(t.teamNumber);
      const p = pitByTeam.get(t.teamNumber);
      return {
        teamNumber: t.teamNumber,
        name: t.name,
        region: t.region,
        rank: t.rank,
        epa: t.epa,
        oprNp: t.oprNp,
        oprAuto: t.oprAuto,
        oprTele: t.oprTele,
        reportCount: a?.count ?? 0,
        autoZone: a ? dominant(a.auto, ["far", "near", "none"]) : null,
        teleopZone: a ? dominant(a.teleop, ["far", "near", "none"]) : null,
        endgame: a ? dominant(a.endgame, ["climb", "tilt", "park", "none"]) : null,
        autoCounts: a?.auto ?? {},
        teleopCounts: a?.teleop ?? {},
        endgameCounts: a?.endgame ?? {},
        pit: p
          ? {
              farAuto: p.farAuto,
              nearAuto: p.nearAuto,
              farTele: p.farTele,
              nearTele: p.nearTele,
              canPark: p.canPark,
              canTilt: p.canTilt,
              canClimb: p.canClimb,
              robotStatus: p.robotStatus,
            }
          : null,
      };
    });
  },
});
