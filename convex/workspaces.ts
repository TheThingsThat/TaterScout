import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireAdmin, checkLen } from "./lib";
import type { Id } from "./_generated/dataModel";

// Unambiguous join code (no 0/O/1/I).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeJoinCode(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

/** Create a workspace. The creator becomes admin; the event is chosen later
 *  (searched + imported in Setup). */
export const create = mutation({
  args: {
    name: v.string(),
    season: v.number(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");
    checkLen(args.name, 80, "Workspace name");
    checkLen(args.displayName, 60, "Your name");
    // A unique join code (retry a few times on the rare collision).
    let joinCode = makeJoinCode();
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db
        .query("workspaces")
        .withIndex("by_joinCode", (q) => q.eq("joinCode", joinCode))
        .unique();
      if (!clash) break;
      joinCode = makeJoinCode();
    }
    const workspaceId = await ctx.db.insert("workspaces", {
      name: args.name,
      season: args.season,
      eventCode: "", // set later via setEvent (Setup screen)
      joinCode,
      adminUserId: userId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("members", {
      workspaceId,
      userId,
      name: args.displayName,
      role: "admin",
    });
    return { workspaceId, joinCode };
  },
});

/** Delete every scouting doc for a workspace, plus the imported event snapshot
 *  (used when the event changes — all of it belonged to the old event). */
async function clearScoutingData(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const reports = await ctx.db
    .query("matchReports")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const pits = await ctx.db
    .query("pitReports")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const claims = await ctx.db
    .query("matchClaims")
    .withIndex("by_workspace_match_team", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const assigns = await ctx.db
    .query("assignments")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const shorts = await ctx.db
    .query("shortlist")
    .withIndex("by_workspace_member", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  // Old event's roster + schedule, so a failed re-import can't leave stale data
  // that scouts could file reports against.
  const teamRows = await ctx.db
    .query("teamEvents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const matchRows = await ctx.db
    .query("matches")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  for (const r of [...reports, ...pits, ...claims, ...assigns, ...shorts, ...teamRows, ...matchRows]) {
    await ctx.db.delete(r._id);
  }
}

/** Set (or change) the workspace's event — admin only. Changing the event code
 *  wipes the workspace's scouting data (it belonged to the old event). */
export const setEvent = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    eventCode: v.string(),
    eventName: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, eventCode, eventName, timezone }) => {
    await requireAdmin(ctx, workspaceId);
    checkLen(eventName, 200, "Event name");
    const ws = await ctx.db.get(workspaceId);
    const next = eventCode.trim().toUpperCase();
    if (ws && ws.eventCode && ws.eventCode !== next) {
      await clearScoutingData(ctx, workspaceId);
      await ctx.db.patch(workspaceId, { eventCode: next, eventName, timezone, myTeam: undefined });
    } else {
      await ctx.db.patch(workspaceId, { eventCode: next, eventName, timezone });
    }
  },
});

/** Set which team this workspace scouts for (drives the Overview "Up next"). */
export const setMyTeam = mutation({
  args: { workspaceId: v.id("workspaces"), teamNumber: v.union(v.number(), v.null()) },
  handler: async (ctx, { workspaceId, teamNumber }) => {
    await requireAdmin(ctx, workspaceId);
    await ctx.db.patch(workspaceId, { myTeam: teamNumber ?? undefined });
  },
});

/** Toggle free-scout mode: when on, scouts may scout any match/team (like admin). */
export const setFreeScoutMode = mutation({
  args: { workspaceId: v.id("workspaces"), on: v.boolean() },
  handler: async (ctx, { workspaceId, on }) => {
    await requireAdmin(ctx, workspaceId);
    await ctx.db.patch(workspaceId, { freeScoutMode: on });
  },
});

/** Join an existing workspace by code. Idempotent for an existing member. */
export const join = mutation({
  args: { joinCode: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");
    checkLen(args.displayName, 60, "Your name");
    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_joinCode", (q) => q.eq("joinCode", args.joinCode.trim().toUpperCase()))
      .unique();
    if (!ws) throw new Error("No workspace found for that join code.");
    const existing = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", ws._id).eq("userId", userId))
      .unique();
    if (existing) return { workspaceId: ws._id };
    await ctx.db.insert("members", {
      workspaceId: ws._id,
      userId,
      name: args.displayName,
      role: "scout",
    });
    return { workspaceId: ws._id };
  },
});

/** Workspaces the signed-in user belongs to (for the dashboard). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out = [];
    for (const m of memberships) {
      const ws = await ctx.db.get(m.workspaceId);
      if (ws) out.push({ ...ws, role: m.role, memberId: m._id, memberName: m.name });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** One workspace + the caller's membership (null if not a member). */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) return null;
    const member = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", userId as Id<"users">),
      )
      .unique();
    if (!member) return null; // not a member → no access
    return { workspace: ws, member };
  },
});
