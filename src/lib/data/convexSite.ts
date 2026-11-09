// Server-side Convex reads for the public site, wrapped in unstable_cache so
// the shared Vercel data cache collapses traffic to ~1 Convex execution per
// distinct key per TTL — Convex cost scales with cached keys, not visitors.
//
// Every helper returns `{ v: T } | null`: null means "Convex unavailable"
// (callers degrade to empty results), while `{ v: null }` is a genuine
// "not found". Failures are never cached, so the next request retries.
//
// Lifetimes trade freshness for free-plan quota. Past seasons don't change, so
// they get a day (a reseed can take that long to show up).
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { createHash } from "node:crypto";
import { api } from "@convex/_generated/api";
import { CURRENT_SEASON } from "@/lib/season";

const DAY = 86_400;
const ttl = (season: number, current: number) => (season === CURRENT_SEASON ? current : DAY);

const url = () => process.env.NEXT_PUBLIC_CONVEX_URL!;

/** Thrown inside the cache to return a result without storing it. */
class Uncached<T> {
  constructor(readonly v: T) {}
}

/**
 * Past seasons are seeded once, possibly after their pages were first visited, so
 * a "not found" for one is never cached (it would hide freshly seeded data for the
 * whole TTL), and their keys carry a version that retires anything cached before.
 */
const PAST = "s2";

async function cq<T>(key: (string | number)[], ttl: number, fn: () => Promise<T>) {
  const season = typeof key[1] === "number" ? key[1] : CURRENT_SEASON;
  const past = season < CURRENT_SEASON;
  try {
    return await unstable_cache(
      async (): Promise<{ v: T }> => {
        const v = await fn();
        if (past && v == null) throw new Uncached(v);
        return { v };
      },
      ["convex-site", ...(past ? [PAST] : []), ...key.map(String)],
      { revalidate: ttl },
    )();
  } catch (e) {
    if (e instanceof Uncached) return { v: e.v as T };
    return null;
  }
}

export const siteMeta = (season: number) =>
  cq(["meta", season], ttl(season, 600), () => fetchQuery(api.site.rankings.meta, { season }, { url: url() }));

export const sitePage = (
  season: number,
  q: { sort: string; dir: "asc" | "desc"; region: string | null; page: number; pageSize: number },
) =>
  cq(["page", season, q.sort, q.dir, q.region ?? "-", q.page, q.pageSize], ttl(season, 600), () =>
    fetchQuery(
      api.site.rankings.page,
      { season, sort: q.sort as never, dir: q.dir, region: q.region, page: q.page, pageSize: q.pageSize },
      { url: url() },
    ),
  );

export const siteTeamRow = (season: number, team: number) =>
  cq(["team", season, team], ttl(season, 300), () =>
    fetchQuery(api.site.rankings.team, { season, team }, { url: url() }),
  );

export const siteTeamRows = (season: number, teams: number[]) => {
  const sorted = [...teams].sort((a, b) => a - b);
  const key = createHash("sha1").update(sorted.join(",")).digest("hex").slice(0, 12);
  return cq(["teams", season, key], ttl(season, 300), () =>
    fetchQuery(api.site.rankings.teams, { season, teams: sorted }, { url: url() }),
  );
};

export const siteTrajectory = (season: number, team: number) =>
  cq(["traj", season, team], ttl(season, 300), () =>
    fetchQuery(api.site.trajectories.byTeam, { season, team }, { url: url() }),
  );

/** `settled`: the event finished long enough ago that it won't change. */
export const siteEventStats = (season: number, code: string, settled = false) =>
  cq(["estats", season, code], settled ? DAY : ttl(season, 300), () =>
    fetchQuery(api.site.eventStats.byEvent, { season, code }, { url: url() }),
  );

export const siteSearch = (season: number, q: string) =>
  cq(["search", season, q.toLowerCase()], ttl(season, 3600), () =>
    fetchQuery(api.site.search.search, { season, q }, { url: url() }),
  );
