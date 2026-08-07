// Server-side Convex reads for the public site, wrapped in unstable_cache so
// the shared Vercel data cache collapses traffic to ~1 Convex execution per
// distinct key per TTL — Convex cost scales with cached keys, not visitors.
//
// Every helper returns `{ v: T } | null`: null means "Convex unavailable"
// (callers degrade to empty results), while `{ v: null }` is a genuine
// "not found". A transient failure is cached for its short TTL — acceptable;
// the next TTL expiry retries.
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { createHash } from "node:crypto";
import { api } from "@convex/_generated/api";

const url = () => process.env.NEXT_PUBLIC_CONVEX_URL!;

async function cq<T>(key: (string | number)[], ttl: number, fn: () => Promise<T>) {
  try {
    return await unstable_cache(
      async (): Promise<{ v: T } | null> => {
        try {
          return { v: await fn() };
        } catch {
          return null;
        }
      },
      ["convex-site", ...key.map(String)],
      { revalidate: ttl },
    )();
  } catch {
    return null;
  }
}

export const siteMeta = (season: number) =>
  cq(["meta", season], 60, () => fetchQuery(api.site.rankings.meta, { season }, { url: url() }));

export const sitePage = (
  season: number,
  q: { sort: string; dir: "asc" | "desc"; region: string | null; page: number; pageSize: number },
) =>
  cq(["page", season, q.sort, q.dir, q.region ?? "-", q.page, q.pageSize], 300, () =>
    fetchQuery(
      api.site.rankings.page,
      { season, sort: q.sort as never, dir: q.dir, region: q.region, page: q.page, pageSize: q.pageSize },
      { url: url() },
    ),
  );

export const siteTeamRow = (season: number, team: number) =>
  cq(["team", season, team], 60, () =>
    fetchQuery(api.site.rankings.team, { season, team }, { url: url() }),
  );

export const siteTeamRows = (season: number, teams: number[]) => {
  const sorted = [...teams].sort((a, b) => a - b);
  const key = createHash("sha1").update(sorted.join(",")).digest("hex").slice(0, 12);
  return cq(["teams", season, key], 120, () =>
    fetchQuery(api.site.rankings.teams, { season, teams: sorted }, { url: url() }),
  );
};

export const siteTrajectory = (season: number, team: number) =>
  cq(["traj", season, team], 60, () =>
    fetchQuery(api.site.trajectories.byTeam, { season, team }, { url: url() }),
  );

export const siteEventStats = (season: number, code: string) =>
  cq(["estats", season, code], 120, () =>
    fetchQuery(api.site.eventStats.byEvent, { season, code }, { url: url() }),
  );

export const siteSearch = (season: number, q: string) =>
  cq(["search", season, q.toLowerCase()], 300, () =>
    fetchQuery(api.site.search.search, { season, q }, { url: url() }),
  );
