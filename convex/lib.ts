// Shared auth/membership guards. Every workspace-scoped function calls one of
// these so multi-tenant isolation + roles are enforced in one place.
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export async function requireMember(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in.");
  const member = await ctx.db
    .query("members")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId),
    )
    .unique();
  if (!member) throw new Error("Not a member of this workspace.");
  return member;
}

export async function requireAdmin(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const member = await requireMember(ctx, workspaceId);
  if (member.role !== "admin") throw new Error("Admins only.");
  return member;
}
