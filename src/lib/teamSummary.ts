// One row of the homepage's team tables (starred teams, starred region): a team's
// name, its current-or-next event and its season ratings. Server-only; the
// client imports just the types.
import { getTeamUpcoming } from "@/lib/ftc/queries";
import type { TeamRanking } from "@/lib/rankings";

export interface TeamSummary {
  number: number;
  name: string;
  region: string | null;
  epa: number | null;
  rkEpa: number | null;
  oprNp: number | null;
  rkOprNp: number | null;
  next: {
    code: string;
    name: string;
    type: string;
    ongoing: boolean;
    start: string | null; // venue calendar dates, YYYY-MM-DD
    end: string | null;
    startMs: number | null; // start of the first day at the venue
    endMs: number | null;
    city: string | null;
    state: string | null;
  } | null;
}

export interface TeamSummaryResponse {
  season: number;
  teamCount: number;
  teams: TeamSummary[];
  /** Teams whose lookup failed this time (FIRST or Convex hiccup): retry them. */
  failed: number[];
}

/**
 * Summaries for `nums`, in order. `rankMap` is null when the ratings couldn't be
 * read, which fails every team (a failure isn't "unrated"); a team whose event
 * lookup throws is failed too. Failed teams are listed, never cached as empty.
 */
export async function summarizeTeams(
  season: number,
  nums: number[],
  rankMap: Map<number, TeamRanking> | null,
): Promise<{ teams: TeamSummary[]; failed: number[] }> {
  const ups = await Promise.all(nums.map((n) => getTeamUpcoming(n, season).then((u) => ({ u }), () => null)));
  const teams: TeamSummary[] = [];
  const failed: number[] = [];
  nums.forEach((num, i) => {
    const got = ups[i];
    if (!got || !rankMap) {
      failed.push(num);
      return;
    }
    const up = got.u;
    const rk = rankMap.get(num) ?? null;
    const e = up?.next ?? null;
    teams.push({
      number: num,
      name: up?.name ?? rk?.name ?? `Team ${num}`,
      region: rk?.region ?? null,
      epa: rk?.epa ?? null,
      rkEpa: rk?.rkEpa ?? null,
      oprNp: rk?.oprNp ?? null,
      rkOprNp: rk?.rkOprNp ?? null,
      next: e
        ? {
            code: e.code,
            name: e.name,
            type: e.type,
            ongoing: e.ongoing,
            start: e.start.slice(0, 10) || null,
            end: e.end.slice(0, 10) || null,
            startMs: e.startMs,
            endMs: e.endMs,
            city: e.location.city,
            state: e.location.state,
          }
        : null,
    });
  });
  return { teams, failed };
}

export const cacheHeader = (failed: number[]) =>
  failed.length ? "no-store" : "public, max-age=60, stale-while-revalidate=300";
