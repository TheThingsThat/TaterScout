import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireAdmin } from "./lib";
import type { Id } from "./_generated/dataModel";

const ownerKind = v.union(v.literal("primary"), v.literal("personal"));
const tierV = v.union(
  v.literal("t1"),
  v.literal("t2"),
  v.literal("t3"),
  v.literal("dnp"),
  v.literal("uncat"),
);

/** Ensure the board exists and every imported team has an entry (uncategorized).
 *  Personal = the caller's own board; primary requires admin. */
export const ensure = mutation({
  args: { workspaceId: v.id("workspaces"), kind: ownerKind },
  handler: async (ctx, { workspaceId, kind }) => {
    const member =
      kind === "primary"
        ? await requireAdmin(ctx, workspaceId)
        : await requireMember(ctx, workspaceId);
    const owner: "primary" | Id<"members"> = kind === "primary" ? "primary" : member._id;

    let pl = await ctx.db
      .query("picklists")
      .withIndex("by_workspace_owner", (q) => q.eq("workspaceId", workspaceId).eq("owner", owner))
      .unique();
    if (!pl) {
      const id = await ctx.db.insert("picklists", { workspaceId, owner });
      pl = await ctx.db.get(id);
    }
    const teams = await ctx.db
      .query("teamEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const entries = await ctx.db
      .query("picklistEntries")
      .withIndex("by_picklist", (q) => q.eq("picklistId", pl!._id))
      .collect();
    const have = new Set(entries.map((e) => e.teamNumber));
    let rank = entries.length;
    for (const t of teams) {
      if (!have.has(t.teamNumber)) {
        await ctx.db.insert("picklistEntries", {
          workspaceId,
          picklistId: pl!._id,
          teamNumber: t.teamNumber,
          tier: "uncat",
          rank: rank++,
        });
      }
    }
    return pl!._id;
  },
});

/** Read a board (any member); `editable` reflects role/ownership. */
export const board = query({
  args: { workspaceId: v.id("workspaces"), kind: ownerKind },
  handler: async (ctx, { workspaceId, kind }) => {
    const member = await requireMember(ctx, workspaceId);
    const owner: "primary" | Id<"members"> = kind === "primary" ? "primary" : member._id;
    const pl = await ctx.db
      .query("picklists")
      .withIndex("by_workspace_owner", (q) => q.eq("workspaceId", workspaceId).eq("owner", owner))
      .unique();
    const entries = pl
      ? await ctx.db
          .query("picklistEntries")
          .withIndex("by_picklist", (q) => q.eq("picklistId", pl._id))
          .collect()
      : [];
    const teams = await ctx.db
      .query("teamEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const nameByTeam = new Map(teams.map((t) => [t.teamNumber, t.name]));
    return {
      picklistId: pl?._id ?? null,
      editable: kind === "personal" || member.role === "admin",
      entries: entries
        .map((e) => ({
          _id: e._id,
          teamNumber: e.teamNumber,
          name: nameByTeam.get(e.teamNumber) ?? `Team ${e.teamNumber}`,
          tier: e.tier,
          rank: e.rank,
        }))
        .sort((a, b) => a.rank - b.rank),
    };
  },
});

/** Move an entry to a tier at an index (fractional rank between neighbors). */
export const moveEntry = mutation({
  args: { entryId: v.id("picklistEntries"), toTier: tierV, toIndex: v.number() },
  handler: async (ctx, { entryId, toTier, toIndex }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry) throw new Error("Entry not found.");
    const pl = await ctx.db.get(entry.picklistId);
    if (!pl) throw new Error("Board not found.");
    const member = await requireMember(ctx, entry.workspaceId);
    if (pl.owner === "primary") {
      if (member.role !== "admin") throw new Error("Only admins edit the primary board.");
    } else if (pl.owner !== member._id) {
      throw new Error("Not your board.");
    }
    const dest = (
      await ctx.db
        .query("picklistEntries")
        .withIndex("by_picklist_tier", (q) => q.eq("picklistId", entry.picklistId).eq("tier", toTier))
        .collect()
    )
      .filter((e) => e._id !== entryId)
      .sort((a, b) => a.rank - b.rank);
    const before = dest[toIndex - 1]?.rank;
    const after = dest[toIndex]?.rank;
    let rank: number;
    if (before == null && after == null) rank = 0;
    else if (before == null) rank = (after as number) - 1;
    else if (after == null) rank = before + 1;
    else rank = (before + after) / 2;
    await ctx.db.patch(entryId, { tier: toTier, rank });
  },
});

// Tier → numeric score for consensus. `uncat` = no opinion (ignored).
const TIER_SCORE: Record<string, number | null> = { t1: 3, t2: 2, t3: 1, uncat: null, dnp: -2 };

/** Merge everyone's personal boards into the primary board (admin only).
 *  Consensus tier = mean of scorers' tier scores (uncat ignored); order within a
 *  tier by that mean, EPA as the tiebreaker. */
export const mergeIntoPrimary = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireAdmin(ctx, workspaceId);

    const boards = await ctx.db
      .query("picklists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const personals = boards.filter((b) => b.owner !== "primary");
    const primary = boards.find((b) => b.owner === "primary");
    if (!primary) throw new Error("No primary board.");

    // Collect each team's tier scores across personal boards.
    const scores = new Map<number, number[]>();
    for (const pl of personals) {
      const entries = await ctx.db
        .query("picklistEntries")
        .withIndex("by_picklist", (q) => q.eq("picklistId", pl._id))
        .collect();
      for (const e of entries) {
        const s = TIER_SCORE[e.tier];
        if (s == null) continue;
        (scores.get(e.teamNumber) ?? scores.set(e.teamNumber, []).get(e.teamNumber)!).push(s);
      }
    }

    const teams = await ctx.db
      .query("teamEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    const results = teams.map((t) => {
      const arr = scores.get(t.teamNumber);
      const mean = arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      let tier: string;
      if (mean == null) tier = "uncat";
      else if (mean >= 2.5) tier = "t1";
      else if (mean >= 1.5) tier = "t2";
      else if (mean >= 0.5) tier = "t3";
      else if (mean <= -0.5) tier = "dnp";
      else tier = "uncat";
      return { teamNumber: t.teamNumber, tier, score: mean ?? -Infinity, epa: t.epa ?? 0 };
    });

    // Replace primary entries with the consensus, ranked within each tier.
    const existing = await ctx.db
      .query("picklistEntries")
      .withIndex("by_picklist", (q) => q.eq("picklistId", primary._id))
      .collect();
    for (const e of existing) await ctx.db.delete(e._id);

    const byTier = new Map<string, typeof results>();
    for (const r of results) (byTier.get(r.tier) ?? byTier.set(r.tier, []).get(r.tier)!).push(r);
    for (const [tier, list] of byTier) {
      list.sort((a, b) => b.score - a.score || b.epa - a.epa);
      let rank = 0;
      for (const r of list) {
        await ctx.db.insert("picklistEntries", {
          workspaceId,
          picklistId: primary._id,
          teamNumber: r.teamNumber,
          tier: tier as "t1" | "t2" | "t3" | "dnp" | "uncat",
          rank: rank++,
        });
      }
    }
    return { mergedBoards: personals.length, teams: results.length };
  },
});
