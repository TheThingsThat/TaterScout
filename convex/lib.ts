// Shared auth/membership guards. Every workspace-scoped function calls one of
// these so multi-tenant isolation + roles are enforced in one place.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Throw a message the USER is meant to read.
 *
 * A production Convex deployment redacts plain `Error` messages to a generic
 * "Server Error" (dev shows them, which is why this only bites after deploy).
 * `ConvexError` payloads are delivered intact, so every failure a person can
 * legitimately hit — permission denied, already claimed, too long — must use
 * this. Reserve plain `throw new Error` for genuine invariant violations that
 * users should never see.
 */
export function fail(message: string): never {
  throw new ConvexError(message);
}

export async function requireMember(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) fail("Not signed in.");
  const member = await ctx.db
    .query("members")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .unique();
  if (!member) fail("Not a member of this workspace.");
  return member;
}

export async function requireAdmin(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const member = await requireMember(ctx, workspaceId);
  if (member.role !== "admin") fail("Admins only.");
  return member;
}

/** Whether the caller may scout anything in this workspace (admin, or the
 *  workspace has free-scout mode on). Scouts are otherwise limited to their
 *  assignments — see requireMatchAccess / requirePitAccess. */
async function canScoutAnything(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  member: { role: "admin" | "scout" },
): Promise<boolean> {
  if (member.role === "admin") return true;
  const ws = await ctx.db.get(workspaceId);
  return !!ws?.freeScoutMode;
}

/** Guard for match scouting: the member must be assigned this (match, team)
 *  unless they're an admin or free-scout mode is on. Also verifies the robot is
 *  actually in that match, so bad numbers can't create phantom reports. */
export async function requireMatchAccess(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  matchNumber: number,
  teamNumber: number,
) {
  const member = await requireMember(ctx, workspaceId);

  const match = await ctx.db
    .query("matches")
    .withIndex("by_workspace_match", (q) =>
      q.eq("workspaceId", workspaceId).eq("matchNumber", matchNumber),
    )
    .unique();
  if (!match) fail(`Match ${matchNumber} is not in this event's schedule.`);
  if (!match.red.includes(teamNumber) && !match.blue.includes(teamNumber)) {
    fail(`Team ${teamNumber} is not in match ${matchNumber}.`);
  }

  if (await canScoutAnything(ctx, workspaceId, member)) return member;

  const assigned = await ctx.db
    .query("assignments")
    .withIndex("by_workspace_kind_match_team", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("kind", "match")
        .eq("matchNumber", matchNumber)
        .eq("teamNumber", teamNumber),
    )
    .collect();
  if (!assigned.some((a) => a.memberId === member._id)) {
    fail("That match isn't assigned to you.");
  }
  return member;
}

/** Guard for pit scouting: the member must be assigned this team unless they're
 *  an admin or free-scout mode is on. Also verifies the team is in the event. */
export async function requirePitAccess(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  teamNumber: number,
) {
  const member = await requireMember(ctx, workspaceId);

  const team = await ctx.db
    .query("teamEvents")
    .withIndex("by_workspace_team", (q) =>
      q.eq("workspaceId", workspaceId).eq("teamNumber", teamNumber),
    )
    .unique();
  if (!team) fail(`Team ${teamNumber} is not registered for this event.`);

  if (await canScoutAnything(ctx, workspaceId, member)) return member;

  const mine = await ctx.db
    .query("assignments")
    .withIndex("by_workspace_member", (q) =>
      q.eq("workspaceId", workspaceId).eq("memberId", member._id),
    )
    .collect();
  if (!mine.some((a) => a.kind === "pit" && a.teamNumber === teamNumber)) {
    fail("That team isn't assigned to you for pit scouting.");
  }
  return member;
}

/** Reject oversized user text/arrays so a member can't bloat the workspace. */
export function checkLen(value: string | undefined, max: number, label: string): void {
  if (value != null && value.length > max) {
    fail(`${label} is too long (max ${max} characters).`);
  }
}

export function checkTags(tags: string[], maxCount: number, maxLen: number, label: string): void {
  if (tags.length > maxCount) fail(`Too many ${label} (max ${maxCount}).`);
  for (const t of tags) checkLen(t, maxLen, label);
}

/** A tally of things that happened: whole, non-negative, and bounded. The UI
 *  steppers can't produce anything else, but the mutation is a public API. */
export function checkCount(value: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${label} must be a whole number of 0 or more.`);
  }
  if (value > max) fail(`${label} is unrealistically high (max ${max}).`);
}
