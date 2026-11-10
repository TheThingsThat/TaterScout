// Demo mode: a throwaway anonymous session whose data never outlives it.
//
// Deletion is driven by expiry, on purpose. Every session carries an expiry
// that the open tab pushes forward, and `reapExpired` sweeps anything past it
// regardless of how the user left — no unload event fires on a crash, a
// force-quit, or a phone killing a background tab, so a beacon-only design
// leaks rows forever. The tab-close beacon (/api/scout/demo-end) only pulls the
// expiry in to a few minutes (a reload fires the same event, so it can't wipe
// outright); "End demo" is the one path that wipes immediately.
import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { adminWorkspaceCount } from "./lib";

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

/** Rows one wipe pass may delete. Keeps a pass well inside Convex's
 *  per-transaction read/write limits however big a demo got; anything left
 *  over resumes in a scheduled follow-up instead of throwing (a throw would
 *  roll the pass back, and the reaper would hit the same session forever). */
const WIPE_BUDGET = 1000;
type Budget = { left: number };

/** Delete up to the remaining budget of rows from one query. True once the
 *  query has nothing left. */
async function drain(
  ctx: MutationCtx,
  budget: Budget,
  take: (n: number) => Promise<{ _id: Id<TableNames> }[]>,
): Promise<boolean> {
  if (budget.left <= 0) return false;
  const n = budget.left;
  const rows = await take(n);
  for (const r of rows) await ctx.db.delete(r._id);
  budget.left -= rows.length;
  return rows.length < n;
}

/** Delete everything a demo user created: their workspaces and all data scoped
 *  to them, then the session row. Resumable: it stops when the budget runs out
 *  and returns done=false, and a re-run picks up whatever rows are left. Safe
 *  to call twice (the beacon and the reaper can race), so every step tolerates
 *  already-gone rows. The caller's own membership and the session row go last,
 *  since they're how a re-run finds the leftovers. */
async function wipeDemoUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  budget: Budget,
): Promise<{ done: boolean; wiped: number }> {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  let wiped = 0;
  for (const m of memberships) {
    const workspaceId = m.workspaceId;
    const ws = await ctx.db.get(workspaceId);
    // Only ever wipe demo workspaces this user owns. A demo user shouldn't be
    // able to be in a real one (join() blocks it), but this makes the blast
    // radius explicit: no code path here can delete a real team's data. And a
    // demo scout leaving someone else's demo must not take it down with them.
    // An owner-less workspace where they're the last member is theirs to clean
    // up, though, or nothing ever would.
    const owns =
      !!ws?.isDemo &&
      (ws.adminUserId === userId ||
        (
          await ctx.db
            .query("members")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .take(2)
        ).length === 1);
    if (!owns) {
      // Leave like members.remove does: drop their assignments, claims and
      // shortlist; their reports stay with the workspace.
      const left =
        (await drain(ctx, budget, (n) =>
          ctx.db
            .query("assignments")
            .withIndex("by_workspace_member", (q) =>
              q.eq("workspaceId", workspaceId).eq("memberId", m._id),
            )
            .take(n),
        )) &&
        (await drain(ctx, budget, (n) =>
          ctx.db
            .query("matchClaims")
            .withIndex("by_member", (q) => q.eq("memberId", m._id))
            .take(n),
        )) &&
        (await drain(ctx, budget, (n) =>
          ctx.db
            .query("shortlist")
            .withIndex("by_workspace_member", (q) =>
              q.eq("workspaceId", workspaceId).eq("memberId", m._id),
            )
            .take(n),
        ));
      if (!left) return { done: false, wiped };
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
    ] as const) {
      const empty = await drain(ctx, budget, (n) =>
        ctx.db
          .query(table)
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .take(n),
      );
      if (!empty) return { done: false, wiped };
    }
    // ...the two whose workspace index carries a second column...
    const restEmpty =
      (await drain(ctx, budget, (n) =>
        ctx.db
          .query("matchClaims")
          .withIndex("by_workspace_match_team", (q) => q.eq("workspaceId", workspaceId))
          .take(n),
      )) &&
      (await drain(ctx, budget, (n) =>
        ctx.db
          .query("shortlist")
          .withIndex("by_workspace_member", (q) => q.eq("workspaceId", workspaceId))
          .take(n),
      )) &&
      // ...and every other member (their own row goes with the workspace).
      (await drain(ctx, budget, async (n) =>
        (
          await ctx.db
            .query("members")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .take(n + 1)
        )
          .filter((r) => r._id !== m._id)
          .slice(0, n),
      ));
    if (!restEmpty) return { done: false, wiped };

    await ctx.db.delete(m._id);
    await ctx.db.delete(workspaceId);
    wiped++;
  }

  const session = await demoSessionFor(ctx, userId);
  if (session) await ctx.db.delete(session._id);
  return { done: true, wiped };
}

/** Continue a wipe that ran out of budget, rescheduling until it's done. */
export const wipeUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (!(await isDemoUser(ctx, userId))) return null; // never touch a real account
    const r = await wipeDemoUser(ctx, userId, { left: WIPE_BUDGET });
    if (!r.done) await ctx.scheduler.runAfter(0, internal.demo.wipeUser, { userId });
    return null;
  },
});

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
    const expiresAt = Date.now() + DEMO_TTL_MS;
    if (session) {
      await ctx.db.patch(session._id, { expiresAt });
    } else if (await isDemoUser(ctx, userId)) {
      // The row is gone (another tab's wipe, or the reaper) while this tab is
      // still in use. Re-register so whatever it creates next can be reaped.
      await ctx.db.insert("demoSessions", { userId, createdAt: Date.now(), expiresAt });
    }
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
    // Same count workspaces.create checks the cap against.
    const owned = await adminWorkspaceCount(ctx, userId, MAX_DEMO_WORKSPACES + 1);
    return {
      isDemo: true as const,
      // null until the banner has registered the session (a moment after sign-in).
      expiresAt: session?.expiresAt ?? null,
      workspacesUsed: owned,
      maxWorkspaces: MAX_DEMO_WORKSPACES,
    };
  },
});

/** Tab-close beacon: don't wipe now (a reload, or closing a second /scout tab,
 *  fires the same pagehide). Shorten the expiry to just past the open-tab touch
 *  interval instead, so any still-open or reloaded tab (start() on mount,
 *  touch() every 5 min) pushes it back to the full TTL, and reapExpired sweeps
 *  it otherwise. */
const LEAVE_GRACE_MS = 6 * 60 * 1000; // must exceed DemoBanner's TOUCH_INTERVAL_MS (5 min)
export const leave = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await isDemoUser(ctx, userId))) return { wiped: 0 };
    const session = await demoSessionFor(ctx, userId);
    if (session) {
      await ctx.db.patch(session._id, {
        expiresAt: Math.min(session.expiresAt, Date.now() + LEAVE_GRACE_MS),
      });
    }
    return { wiped: 0 };
  },
});

/** End the demo and wipe everything. Called by the explicit "End demo" button.
 *  Safe to call when there's nothing to wipe. A demo too big for one pass
 *  finishes in the background rather than failing the button. */
export const end = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { wiped: 0 };
    if (!(await isDemoUser(ctx, userId))) return { wiped: 0 }; // never touch a real account
    const r = await wipeDemoUser(ctx, userId, { left: WIPE_BUDGET });
    if (!r.done) await ctx.scheduler.runAfter(0, internal.demo.wipeUser, { userId });
    return { wiped: r.wiped };
  },
});

/** Safety net: sweep sessions whose expiry has passed. This is what makes the
 *  "demo data never accumulates" promise true even when no unload event ever
 *  fired. Each run shares one row budget across its sessions, and reschedules
 *  itself while work remains, so no single demo can push a run past Convex's
 *  limits and the backlog drains without waiting for the next cron tick. */
export const reapExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("demoSessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(20);
    const budget: Budget = { left: WIPE_BUDGET };
    let sessions = 0;
    let workspaces = 0;
    let more = expired.length === 20;
    for (const s of expired) {
      const r = await wipeDemoUser(ctx, s.userId, budget);
      workspaces += r.wiped;
      if (!r.done) {
        more = true;
        break;
      }
      sessions++;
    }
    if (more) await ctx.scheduler.runAfter(0, internal.demo.reapExpired, {});
    if (sessions > 0 || workspaces > 0) {
      console.log(`[demo reaper] wiped ${sessions} expired session(s), ${workspaces} workspace(s)`);
    }
    return { sessions, workspaces };
  },
});
