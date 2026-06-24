import { NextRequest, NextResponse } from "next/server";
import { searchTeams, searchEvents } from "@/lib/ftc/queries";
import { CURRENT_SEASON } from "@/lib/season";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const season =
    Number(req.nextUrl.searchParams.get("season")) || CURRENT_SEASON;

  if (q.length < 2) {
    return NextResponse.json({ teams: [], events: [] });
  }

  const [teams, events] = await Promise.all([
    searchTeams(q, 25).catch(() => []),
    searchEvents(q, season, 25).catch(() => []),
  ]);

  // The FTCScout API doesn't reliably honor `limit`, so cap here for a tidy dropdown.
  return NextResponse.json({
    teams: teams.slice(0, 6),
    events: events.slice(0, 6),
  });
}
