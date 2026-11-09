// Starred teams: a signed-in user's followed teams on the public site.
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { fail } from "./lib";
import { isDemoUser } from "./demo";

export const MAX_STARS = 25;

/**
 * Everything the public site needs about the caller in ONE subscription: the
 * header, the team-page star button and the homepage share it. null when signed
 * out. Demo (anonymous) users can't star: their data is wiped with the demo.
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const rows = await ctx.db
      .query("stars")
      .withIndex("by_user_team", (q) => q.eq("userId", userId))
      .take(MAX_STARS);
    const region = await ctx.db
      .query("regionStars")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
      isDemo: user.isAnonymous === true,
      teams: rows.map((r) => r.team),
      region: region?.region ?? null,
    };
  },
});

/** Star or unstar a team. Idempotent: setting the state it's already in is a no-op. */
export const set = mutation({
  args: { team: v.number(), starred: v.boolean() },
  handler: async (ctx, { team, starred }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) fail("Sign in to star teams.");
    if (!Number.isInteger(team) || team < 1 || team > 999_999) fail("That isn't a team number.");
    if (await isDemoUser(ctx, userId)) fail("Create an account to star teams — demo data is deleted when the demo ends.");

    const existing = await ctx.db
      .query("stars")
      .withIndex("by_user_team", (q) => q.eq("userId", userId).eq("team", team))
      .unique();
    if (!starred) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (existing) return;
    const count = (
      await ctx.db
        .query("stars")
        .withIndex("by_user_team", (q) => q.eq("userId", userId))
        .take(MAX_STARS)
    ).length;
    if (count >= MAX_STARS) fail(`You can star up to ${MAX_STARS} teams. Unstar one first.`);
    await ctx.db.insert("stars", { userId, team });
  },
});

/** Follow a region on the homepage (replacing any other), or stop with null. */
export const setRegion = mutation({
  args: { region: v.union(v.string(), v.null()) },
  handler: async (ctx, { region }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) fail("Sign in to star a region.");
    if (region !== null && !/^[A-Z0-9]{1,16}$/.test(region)) fail("That isn't a region code.");
    if (await isDemoUser(ctx, userId)) fail("Create an account to star a region — demo data is deleted when the demo ends.");

    // Mutations are serializable transactions, so this stays at most one row.
    const keep = await ctx.db
      .query("regionStars")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (region === null) {
      if (keep) await ctx.db.delete(keep._id);
    } else if (keep) {
      if (keep.region !== region) await ctx.db.patch(keep._id, { region });
    } else {
      await ctx.db.insert("regionStars", { userId, region });
    }
  },
});
