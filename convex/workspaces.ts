import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireAdmin } from "./lib";
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
    // The admin's "primary" board.
    await ctx.db.insert("picklists", { workspaceId, owner: "primary" });
    return { workspaceId, joinCode };
  },
});

/** Set (or change) the workspace's event — admin only. */
export const setEvent = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    eventCode: v.string(),
    eventName: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, eventCode, eventName }) => {
    await requireAdmin(ctx, workspaceId);
    await ctx.db.patch(workspaceId, { eventCode: eventCode.trim().toUpperCase(), eventName });
  },
});

/** Join an existing workspace by code. Idempotent for an existing member. */
export const join = mutation({
  args: { joinCode: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");
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
    const memberId = await ctx.db.insert("members", {
      workspaceId: ws._id,
      userId,
      name: args.displayName,
      role: "scout",
    });
    // Each scout gets a personal pick-list board.
    await ctx.db.insert("picklists", { workspaceId: ws._id, owner: memberId });
    return { workspaceId: ws._id };
  },
});

/** Workspaces the signed-in user belongs to (for the dashboard). */
export const mine = query({
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
