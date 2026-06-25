import { NextRequest, NextResponse } from "next/server";
import { searchAll } from "@/lib/ftc/queries";
import { CURRENT_SEASON } from "@/lib/season";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const season =
    Number(req.nextUrl.searchParams.get("season")) || CURRENT_SEASON;

  if (q.length < 2) {
    return NextResponse.json({ teams: [], events: [] });
  }

  // One round-trip for both; FTCScout ignores `limit`, so cap here for a tidy
  // dropdown. The underlying gql is cached ~10 min; let clients/CDN cache too.
  const { teams, events } = await searchAll(q, season).catch(() => ({
    teams: [],
    events: [],
  }));

  return NextResponse.json(
    { teams: teams.slice(0, 6), events: events.slice(0, 6) },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      },
    },
  );
}
