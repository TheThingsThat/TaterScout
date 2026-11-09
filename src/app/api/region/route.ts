import { NextRequest, NextResponse } from "next/server";
import { getTeamCount, queryRankings } from "@/lib/rankings";
import { CURRENT_SEASON } from "@/lib/season";
import { cacheHeader, summarizeTeams, type TeamSummaryResponse } from "@/lib/teamSummary";

const TOP_N = 10;

export interface RegionResponse extends TeamSummaryResponse {
  region: string;
  regionTeamCount: number;
}

/**
 * A region's top 10 teams by EPA, summarized like starred teams: `?region=USTXCE`.
 * The leaderboard page read is cached and shared with /rankings; unknown regions
 * are answered from the cached season metadata without touching Convex further.
 * The middleware charges this route as 10 team lookups (proxy.ts).
 */
export async function GET(req: NextRequest) {
  const region = (req.nextUrl.searchParams.get("region") ?? "").trim();
  const season = CURRENT_SEASON;
  const [teamCount, top] = await Promise.all([
    getTeamCount(season).catch(() => 0),
    queryRankings(season, { region, sort: "epa", dir: "desc", page: 1, pageSize: TOP_N }).catch(() => null),
  ]);
  // pages 0 is queryRankings' "Convex unavailable".
  if (!top || top.pages === 0) {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const rows = top.rows.slice(0, TOP_N);
  const rankMap = new Map(rows.map((r) => [r.number, r]));
  const { teams, failed } = await summarizeTeams(
    season,
    rows.map((r) => r.number),
    rankMap,
  );
  const body: RegionResponse = { season, teamCount, teams, failed, region, regionTeamCount: top.total };
  return NextResponse.json(body, { headers: { "Cache-Control": cacheHeader(failed) } });
}
