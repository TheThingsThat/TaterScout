import { NextRequest, NextResponse } from "next/server";
import { getEvent } from "@/lib/ftc/queries";
import { getRankingMap, getSeasonCyclePrior } from "@/lib/rankings";
import { predictMatchTimes, FTC_DEFAULTS, type SchedMatch } from "@/lib/predict/matchTimes";
import { isKnownSeason, isValidEventCode } from "@/lib/season";

export const dynamic = "force-dynamic";

// Assemble a scouting snapshot from public FIRST data + TaterScout's EPA/OPR and
// predicted match times. Returns only public data; the Convex mutation that
// stores it verifies the caller is the workspace admin.
export async function GET(req: NextRequest) {
  const season = Number(req.nextUrl.searchParams.get("season"));
  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase();
  if (!season || !code) {
    return NextResponse.json({ error: "season and code are required" }, { status: 400 });
  }
  // Both reach credentialed FIRST API URLs — reject anything unexpected so this
  // public route can't be used to probe arbitrary upstream paths.
  if (!isKnownSeason(season) || !isValidEventCode(code)) {
    return NextResponse.json({ error: "Invalid season or event code." }, { status: 400 });
  }

  let ev;
  try {
    ev = await getEvent(season, code);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  if (!ev) return NextResponse.json({ error: `No event "${code}" in ${season}.` }, { status: 404 });

  const teamNumbers = ev.teams.map((t) => t.teamNumber);
  const ranking = await getRankingMap(season, teamNumbers);
  const teams = ev.teams.map((t) => {
    const r = ranking.get(t.teamNumber);
    return {
      teamNumber: t.teamNumber,
      name: t.team.name,
      region: r?.region ?? null,
      rank: t.stats?.rank ?? null,
      epa: r?.epa ?? null,
      oprNp: r?.oprNp ?? null,
      oprAuto: r?.oprAuto ?? null,
      oprTele: r?.oprTele ?? null,
    };
  });

  // Qual schedule with our predicted start times (not FTC's).
  const quals = ev.matches.filter((m) => m.tournamentLevel === "Quals");
  const sched: SchedMatch[] = quals.map((m) => ({
    key: `${m.matchNum}`,
    scheduled: m.scheduledStartTime ? Date.parse(m.scheduledStartTime) : null,
    actual: m.actualStartTime ? Date.parse(m.actualStartTime) : null,
    played: m.hasBeenPlayed,
  }));
  const { predicted } = predictMatchTimes(sched, {
    ...FTC_DEFAULTS,
    seasonPriorSec: await getSeasonCyclePrior(season, ev.type),
  });

  const matches = quals.map((m) => ({
    matchNumber: m.matchNum,
    red: m.teams.filter((t) => t.alliance === "Red").map((t) => t.teamNumber),
    blue: m.teams.filter((t) => t.alliance === "Blue").map((t) => t.teamNumber),
    predictedTime:
      predicted.get(`${m.matchNum}`) ??
      (m.scheduledStartTime ? Date.parse(m.scheduledStartTime) : null),
    actualStartTime: m.actualStartTime ? Date.parse(m.actualStartTime) : null,
    redScore: m.scores?.red?.totalPoints ?? null,
    blueScore: m.scores?.blue?.totalPoints ?? null,
  }));

  return NextResponse.json({ eventName: ev.name, teams, matches });
}
