import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { checkLen, fail, requireAdmin } from "./lib";

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
    // The arrays come from a caller-controlled request, so bound them: a real
    // FTC event is ~128 teams / ~200 matches, and every other bulk write in the
    // codebase carries an explicit cap. Keeps one call from blowing the
    // per-mutation write limit.
    if (args.teams.length > 600) fail("Too many teams in snapshot (max 600).");
    if (args.matches.length > 1000) fail("Too many matches in snapshot (max 1000).");
    // Bound each row too: the counts alone still let one call write ~16 MB of
    // giant names or alliance arrays, and oversized alliances would let
    // requireMatchAccess accept phantom (match, team) pairs.
    for (const t of args.teams) {
      if (!Number.isInteger(t.teamNumber) || t.teamNumber < 1 || t.teamNumber > 999_999) {
        fail("Bad team number in snapshot.");
      }
      checkLen(t.name, 200, "Team name");
      checkLen(t.region ?? undefined, 64, "Region");
    }
    for (const m of args.matches) {
      if (!Number.isInteger(m.matchNumber) || m.matchNumber < 1) fail("Bad match number in snapshot.");
      if (m.red.length > 3 || m.blue.length > 3) fail("Too many teams in an alliance (max 3).");
    }
    // Lookups by (workspace, team) and (workspace, match) use .unique(), so a
    // duplicate would make those queries throw.
    if (new Set(args.teams.map((t) => t.teamNumber)).size !== args.teams.length) {
      fail("Duplicate team number in snapshot.");
    }
    if (new Set(args.matches.map((m) => m.matchNumber)).size !== args.matches.length) {
      fail("Duplicate match number in snapshot.");
    }

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
