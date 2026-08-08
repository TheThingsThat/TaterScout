import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { fail, requireAdmin, checkLen } from "./lib";
import { isDemoUser, MAX_DEMO_WORKSPACES } from "./demo";
import type { Id } from "./_generated/dataModel";

// Unambiguous join code (no 0/O/1/I). A join code is a bearer credential — it
// grants scout access to a workspace — so it uses the CSPRNG, not Math.random()
// (whose PRNG stream can be reconstructed from observed outputs; an attacker
// can observe their own codes by creating workspaces). 8 chars over this
// 31-char alphabet is ~8.5e11 combinations, ~1000x the old 6-char space, which
// is what makes blind guessing impractical absent a rate limiter.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeJoinCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  // Rejection-free modulo bias is negligible here (256 % 31), and the alphabet
  // is not secret; uniformity within a fraction of a percent is fine.
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Cap on workspaces one account may own. Without it, any signed-up user can
 *  create unlimited workspaces — free database bloat for a public app. */
const MAX_WORKSPACES_PER_USER = 20;

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
    if (!userId) fail("Not signed in.");
    checkLen(args.name, 80, "Workspace name");
    checkLen(args.displayName, 60, "Your name");
    // Demo sessions get a much tighter cap than real accounts.
    const demo = await isDemoUser(ctx, userId);
    const cap = demo ? MAX_DEMO_WORKSPACES : MAX_WORKSPACES_PER_USER;
    const owned = await ctx.db
      .query("workspaces")
      .withIndex("by_adminUser", (q) => q.eq("adminUserId", userId))
      .take(cap + 1);
    if (owned.length >= cap) {
      // ConvexError, not Error: plain Error messages are redacted to a generic
      // "Server Error" in production, and this one is normal-path UX the user
      // needs to actually read.
      throw new ConvexError(
        demo
          ? `Demo mode is limited to ${cap} workspaces. Sign up for a free account to create more.`
          : `You've reached the limit of ${MAX_WORKSPACES_PER_USER} workspaces.`,
      );
    }
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
      ...(demo ? { isDemo: true } : {}),
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
  },
  handler: async (ctx, { workspaceId, eventCode, eventName }) => {
    await requireAdmin(ctx, workspaceId);
    checkLen(eventName, 200, "Event name");
    const ws = await ctx.db.get(workspaceId);
    const next = eventCode.trim().toUpperCase();
    if (ws && ws.eventCode && ws.eventCode !== next) {
      await clearScoutingData(ctx, workspaceId);
      await ctx.db.patch(workspaceId, { eventCode: next, eventName, myTeam: undefined });
    } else {
      await ctx.db.patch(workspaceId, { eventCode: next, eventName });
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

/** Issue a new join code, invalidating the old one — admin only.
 *
 *  Removing a member deletes their membership but can't un-tell them the code,
 *  so without rotation a removed scout (or anyone they shared it with) could
 *  simply re-join. This is the revocation half of `members.remove`. */
export const rotateJoinCode = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireAdmin(ctx, workspaceId);
    let joinCode = makeJoinCode();
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db
        .query("workspaces")
        .withIndex("by_joinCode", (q) => q.eq("joinCode", joinCode))
        .unique();
      if (!clash) break;
      joinCode = makeJoinCode();
    }
    await ctx.db.patch(workspaceId, { joinCode });
    return { joinCode };
  },
});

/** Join an existing workspace by code. Idempotent for an existing member. */
export const join = mutation({
  args: { joinCode: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) fail("Not signed in.");
    checkLen(args.displayName, 60, "Your name");
    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_joinCode", (q) => q.eq("joinCode", args.joinCode.trim().toUpperCase()))
      .unique();
    if (!ws) fail("No workspace found for that join code.");
    // Keep demo and real workspaces strictly separate in both directions: a
    // demo user must never be able to pollute a real team's event, and a real
    // user must never store work somewhere that gets wiped on a tab close.
    const demo = await isDemoUser(ctx, userId);
    if (demo !== !!ws.isDemo) {
      throw new ConvexError(
        demo
          ? "Demo accounts can only join demo workspaces. Sign up for a free account to join your team's."
          : "That's a demo workspace — its data is wiped when the demo ends. Ask for a code from a real workspace.",
      );
    }
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

/** The join code is a bearer credential: anyone holding it can join. The UI only
 *  shows it to admins, but that's cosmetic — a scout can read whatever the
 *  server sends straight off the wire. So strip it here, for real. */
function redactForRole<T extends { joinCode: string }>(ws: T, role: "admin" | "scout") {
  return role === "admin" ? ws : { ...ws, joinCode: "" };
}

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
      if (ws) {
        out.push({
          ...redactForRole(ws, m.role),
          role: m.role,
          memberId: m._id,
          memberName: m.name,
        });
      }
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
    return { workspace: redactForRole(ws, member.role), member };
  },
});
