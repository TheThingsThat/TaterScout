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
// The site queries are gated on the sync secret so only this server can run
// them. Unset, every read fails validation and degrades like an outage. It goes
// in the query args only, never the cache key.
const secret = () => process.env.SYNC_SECRET!;

/**
 * Past seasons change only through a manual reseed. Their keys carry a version:
 * bump it after reseeding one so stale entries, cached "not found"s included, are
 * retired at once instead of after the 1-day TTL.
 */
const PAST = "s3";

async function cq<T>(key: (string | number)[], ttl: number, fn: () => Promise<T>) {
  const season = typeof key[1] === "number" ? key[1] : CURRENT_SEASON;
  try {
    return await unstable_cache(
      async (): Promise<{ v: T }> => ({ v: await fn() }),
      ["convex-site", ...(season < CURRENT_SEASON ? [PAST] : []), ...key.map(String)],
      { revalidate: ttl },
    )();
  } catch {
    return null;
  }
}

export const siteMeta = (season: number) =>
  cq(["meta", season], ttl(season, 600), () =>
    fetchQuery(api.site.rankings.meta, { secret: secret(), season }, { url: url() }),
  );

export const sitePage = (
  season: number,
  q: { sort: string; dir: "asc" | "desc"; region: string | null; page: number; pageSize: number },
) =>
  cq(["page", season, q.sort, q.dir, q.region ?? "-", q.page, q.pageSize], ttl(season, 600), () =>
    fetchQuery(
      api.site.rankings.page,
      {
        secret: secret(),
        season,
        sort: q.sort as never,
        dir: q.dir,
        region: q.region,
        page: q.page,
        pageSize: q.pageSize,
      },
      { url: url() },
    ),
  );

export const siteTeamRow = (season: number, team: number) =>
  cq(["team", season, team], ttl(season, 300), () =>
    fetchQuery(api.site.rankings.team, { secret: secret(), season, team }, { url: url() }),
  );

export const siteTeamRows = (season: number, teams: number[]) => {
  const sorted = [...teams].sort((a, b) => a - b);
  const key = createHash("sha1").update(sorted.join(",")).digest("hex").slice(0, 12);
  return cq(["teams", season, key], ttl(season, 300), () =>
    fetchQuery(api.site.rankings.teams, { secret: secret(), season, teams: sorted }, { url: url() }),
  );
};

export const siteTrajectory = (season: number, team: number) =>
  cq(["traj", season, team], ttl(season, 300), () =>
    fetchQuery(api.site.trajectories.byTeam, { secret: secret(), season, team }, { url: url() }),
  );

/** `settled`: the event finished long enough ago that it won't change. */
export const siteEventStats = (season: number, code: string, settled = false) =>
  cq(["estats", season, code], settled ? DAY : ttl(season, 300), () =>
    fetchQuery(api.site.eventStats.byEvent, { secret: secret(), season, code }, { url: url() }),
  );

export const siteSearch = (season: number, q: string) =>
  cq(["search", season, q.toLowerCase()], ttl(season, 3600), () =>
    fetchQuery(api.site.search.search, { secret: secret(), season, q }, { url: url() }),
  );
