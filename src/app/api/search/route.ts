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

  // Teams + events from our local search index (loaded from the store); cap to a
  // tidy dropdown. Let clients/CDN cache the response too.
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
