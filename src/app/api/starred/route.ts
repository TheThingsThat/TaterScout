import { NextRequest, NextResponse } from "next/server";
import { getTeamCount, tryRankingMap } from "@/lib/rankings";
import { CURRENT_SEASON } from "@/lib/season";
import { cacheHeader, summarizeTeams, type TeamSummaryResponse } from "@/lib/teamSummary";

// Matches MAX_STARS in convex/stars.ts: nobody has more stars than this.
const MAX_TEAMS = 25;

/**
 * Summaries for the homepage's starred teams: `?teams=641,8393`. Team data is
 * public, so this needs no sign-in; the star list itself comes from Convex on the
 * client. Upcoming events are cached per team (shared across visitors) and the
 * rankings come from one batched Convex read. The middleware charges this route
 * per team requested (proxy.ts), since each one can cost FIRST calls.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("teams") ?? "";
  const nums = [
    ...new Set(
      raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n <= 999_999),
    ),
  ].slice(0, MAX_TEAMS);

  const season = CURRENT_SEASON;
  if (nums.length === 0) {
    const empty: TeamSummaryResponse = { season, teamCount: 0, teams: [], failed: [] };
    return NextResponse.json(empty);
  }
  const [teamCount, rankMap] = await Promise.all([
    getTeamCount(season).catch(() => 0),
    tryRankingMap(season, nums).catch(() => null),
  ]);
  const { teams, failed } = await summarizeTeams(season, nums, rankMap);
  const body: TeamSummaryResponse = { season, teamCount, teams, failed };
  return NextResponse.json(body, { headers: { "Cache-Control": cacheHeader(failed) } });
}
