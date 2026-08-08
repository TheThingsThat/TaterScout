// Demo mode: a throwaway anonymous session whose data never outlives it.
//
// Deletion happens twice over, on purpose. The tab-close beacon
// (/api/scout/demo-end) makes "close the tab and it's gone" true in the normal
// case, but no unload event fires on a crash, a force-quit, or a phone killing
// a background tab — so a beacon-only design leaks rows forever. `reapExpired`
// is the actual guarantee: every session carries an expiry that the open tab
// pushes forward, and anything past it gets swept regardless of how the user
// left.
import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

/** How long a demo survives with no activity. Long enough that a user reading
 *  the page isn't wiped mid-sentence; short enough that abandoned sessions
 *  don't accumulate. The open tab refreshes this every few minutes. */
export const DEMO_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Demo users get a much tighter cap than real accounts. */
export const MAX_DEMO_WORKSPACES = 2;

/**
 * Is this a demo user? Authoritative source is `users.isAnonymous`, which the
 * Anonymous provider sets atomically as part of sign-in.
 *
 * Deliberately NOT the demoSessions row: that's written by a separate client
 * call which can lag (or never happen if the tab closes first), so keying
 * identity off it would let a demo user briefly look like a real one and slip
 * past the workspace cap.
 */
export async function isDemoUser(
  ctx: { db: MutationCtx["db"] },
  userId: Id<"users">,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user?.isAnonymous === true;
}

/** The caller's TTL-tracking session row, if one has been created yet. */
export async function demoSessionFor(
  ctx: { db: MutationCtx["db"] },
  userId: Id<"users">,
) {
  return await ctx.db
    .query("demoSessions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** Delete everything a demo user created: their workspaces and all data scoped
 *  to them, then the session row. Written to be safe to call twice (the beacon
 *  and the reaper can race), so every step tolerates already-gone rows. */
async function wipeDemoUser(ctx: MutationCtx, userId: Id<"users">): Promise<number> {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  let wiped = 0;
  for (const m of memberships) {
    const workspaceId = m.workspaceId;
    const ws = await ctx.db.get(workspaceId);
    // Only ever delete demo workspaces. A demo user shouldn't be able to be in
    // a real one (join() blocks it), but this makes the blast radius explicit:
    // no code path here can delete a real team's data.
    if (!ws?.isDemo) {
      await ctx.db.delete(m._id);
      continue;
    }
    // Tables sharing the plain by_workspace index...
    for (const table of [
      "matchReports",
      "pitReports",
      "assignments",
      "teamEvents",
      "matches",
      "members",
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }
    // ...and the two whose workspace index carries a second column.
    const claims = await ctx.db
      .query("matchClaims")
      .withIndex("by_workspace_match_team", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const shorts = await ctx.db
      .query("shortlist")
      .withIndex("by_workspace_member", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const r of [...claims, ...shorts]) await ctx.db.delete(r._id);

    await ctx.db.delete(workspaceId);
    wiped++;
  }

  const session = await demoSessionFor(ctx, userId);
  if (session) await ctx.db.delete(session._id);
  return wiped;
}

/** Begin a demo session for the just-signed-in anonymous user. Idempotent, so a
 *  double-click or a remount can't create two sessions. */
export const start = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    // Called from the banner as soon as it mounts, which can land a beat before
    // the auth token has propagated. A quiet no-op is correct — the effect
    // re-runs once identity resolves — and avoids a spurious console error.
    if (!userId) return { alreadyStarted: false };
    if (!(await isDemoUser(ctx, userId))) return { alreadyStarted: true }; // real account
    const existing = await demoSessionFor(ctx, userId);
    const expiresAt = Date.now() + DEMO_TTL_MS;
    if (existing) {
      await ctx.db.patch(existing._id, { expiresAt });
      return { alreadyStarted: true };
    }
    await ctx.db.insert("demoSessions", { userId, createdAt: Date.now(), expiresAt });
    return { alreadyStarted: false };
  },
});

/** Push the expiry forward — called periodically by the open demo tab so an
 *  actively-used session is never swept out from under the user. */
export const touch = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    const session = await demoSessionFor(ctx, userId);
    if (session) await ctx.db.patch(session._id, { expiresAt: Date.now() + DEMO_TTL_MS });
  },
});

/** Is the caller in demo mode, and how much room is left? Drives the banner and
 *  the workspace-cap messaging. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { isDemo: false as const };
    const user = await ctx.db.get(userId);
    if (user?.isAnonymous !== true) return { isDemo: false as const };
    const session = await ctx.db
      .query("demoSessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const owned = await ctx.db
      .query("workspaces")
      .withIndex("by_adminUser", (q) => q.eq("adminUserId", userId))
      .take(MAX_DEMO_WORKSPACES + 1);
    return {
      isDemo: true as const,
      // null until the banner has registered the session (a moment after sign-in).
      expiresAt: session?.expiresAt ?? null,
      workspacesUsed: owned.length,
      maxWorkspaces: MAX_DEMO_WORKSPACES,
    };
  },
});

/** End the demo and wipe everything. Called by the tab-close beacon and by the
 *  explicit "End demo" button. Safe to call when there's nothing to wipe. */
export const end = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { wiped: 0 };
    if (!(await isDemoUser(ctx, userId))) return { wiped: 0 }; // never touch a real account
    return { wiped: await wipeDemoUser(ctx, userId) };
  },
});

/** Safety net: sweep sessions whose expiry has passed. This is what makes the
 *  "demo data never accumulates" promise true even when no unload event ever
 *  fired. Bounded per run so one invocation can't exceed Convex's limits; the
 *  cron just picks up the rest on the next tick. */
export const reapExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("demoSessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(20);
    let sessions = 0;
    let workspaces = 0;
    for (const s of expired) {
      workspaces += await wipeDemoUser(ctx, s.userId);
      sessions++;
    }
    if (sessions > 0) {
      console.log(`[demo reaper] wiped ${sessions} expired session(s), ${workspaces} workspace(s)`);
    }
    return { sessions, workspaces };
  },
});
