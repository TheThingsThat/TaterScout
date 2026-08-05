// Team + event search over Convex search indexes (word-prefix) plus exact
// number/code prefix ranges. Replaces the in-memory substring scan over the
// 2.2MB rankings file. The Next route still merges FIRST's live upcoming
// events on top of these results.
import { query } from "../_generated/server";
import { v } from "convex/values";

export const search = query({
  args: { season: v.number(), q: v.string() },
  handler: async (ctx, { season, q }) => {
    const term = q.trim();
    if (term.length < 2) return { teams: [], events: [] };

    // Teams: name search, plus a number-prefix index range for digit queries.
    const nameHits = await ctx.db
      .query("seasonTeams")
      .withSearchIndex("search_name", (s) => s.search("name", term).eq("season", season))
      .take(8);
    let numberHits: typeof nameHits = [];
    if (/^\d{1,6}$/.test(term)) {
      numberHits = await ctx.db
        .query("seasonTeams")
        .withIndex("by_season_numberStr", (i) =>
          i.eq("season", season).gte("numberStr", term).lt("numberStr", term + "￿"),
        )
        .take(8);
    }
    const seenTeams = new Set<number>();
    const teams = [...numberHits, ...nameHits]
      .filter((t) => (seenTeams.has(t.team) ? false : (seenTeams.add(t.team), true)))
      .slice(0, 12)
      .map((t) => ({ number: t.team, name: t.name, region: t.region }));

    // Events: name search plus a code-prefix range for code-looking queries.
    const eventNameHits = await ctx.db
      .query("seasonEvents")
      .withSearchIndex("search_name", (s) => s.search("searchText", term).eq("season", season))
      .take(8);
    let codeHits: typeof eventNameHits = [];
    const code = term.toUpperCase();
    if (/^[A-Z0-9]{2,20}$/.test(code)) {
      codeHits = await ctx.db
        .query("seasonEvents")
        .withIndex("by_season_code", (i) =>
          i.eq("season", season).gte("code", code).lt("code", code + "￿"),
        )
        .take(8);
    }
    const seenCodes = new Set<string>();
    const events = [...codeHits, ...eventNameHits]
      .filter((e) => (seenCodes.has(e.code) ? false : (seenCodes.add(e.code), true)))
      .slice(0, 12)
      .map((e) => ({
        code: e.code,
        name: e.name,
        start: e.start,
        type: e.type,
        city: e.city,
        state: e.state,
        country: e.country,
      }));

    return { teams, events };
  },
});
