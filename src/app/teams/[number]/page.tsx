import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTeam, getEventMatches } from "@/lib/ftc/queries";
import { CURRENT_SEASON, seasonFull, seasonLabel } from "@/lib/season";
import { eventTypeLabel, eventTypeWeight, awardLabel } from "@/lib/ftc/labels";
import { formatDate, formatClock, locationStr } from "@/lib/format";
import { getTeamRanking, getTeamCount, getSeasonCyclePrior } from "@/lib/rankings";
import { getTrajectory } from "@/lib/trajectory";
import { predictMatchTimes, FTC_DEFAULTS, type SchedMatch } from "@/lib/predict/matchTimes";
import StatTiles from "@/components/StatTiles";
import EpaTiles from "@/components/EpaTiles";
import TrajectoryChart from "@/components/TrajectoryChart";
import LiveRefresh from "@/components/LiveRefresh";

interface NextMatch {
  label: string;
  time: number | null;
  timezone: string;
  eventName: string;
  eventCode: string;
}

async function findNextMatch(
  season: number,
  num: number,
  ongoingEventCodes: { code: string; name: string; type: string }[],
): Promise<NextMatch | null> {
  const results = await Promise.all(
    ongoingEventCodes.map((e) =>
      getEventMatches(season, e.code).catch(() => null),
    ),
  );
  let best: NextMatch | null = null;
  results.forEach((res, i) => {
    if (!res) return;
    const ev = ongoingEventCodes[i];
    const quals = res.matches.filter((m) => m.tournamentLevel === "Quals");
    const sched: SchedMatch[] = quals.map((m) => ({
      key: `${m.tournamentLevel}-${m.series}-${m.matchNum}`,
      scheduled: m.scheduledStartTime ? Date.parse(m.scheduledStartTime) : null,
      actual: m.actualStartTime ? Date.parse(m.actualStartTime) : null,
      played: m.hasBeenPlayed,
    }));
    const { predicted } = predictMatchTimes(sched, {
      ...FTC_DEFAULTS,
      seasonPriorSec: getSeasonCyclePrior(season, ev.type),
    });
    const mine = quals
      .filter(
        (m) => !m.hasBeenPlayed && m.teams.some((t) => t.teamNumber === num),
      )
      .map((m) => ({
        m,
        t: predicted.get(`${m.tournamentLevel}-${m.series}-${m.matchNum}`) ?? null,
      }))
      .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
    if (mine.length) {
      const top = mine[0];
      if (best === null || (top.t ?? Infinity) < (best.time ?? Infinity)) {
        best = {
          label: `Q${top.m.matchNum}`,
          time: top.t,
          timezone: res.timezone,
          eventName: ev.name,
          eventCode: ev.code,
        };
      }
    }
  });
  return best;
}

interface Props {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ season?: string }>;
}

function parseSeason(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 2018 ? n : CURRENT_SEASON;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  try {
    const team = await getTeam(Number(number), CURRENT_SEASON);
    if (team) return { title: `${team.number} ${team.name}` };
  } catch {
    /* ignore */
  }
  return { title: `Team ${number}` };
}

const HEADING = "font-mono text-[11px] uppercase tracking-[0.14em] text-muted";
const OUTLINE_BTN =
  "rounded-[10px] border border-[#232323] px-3.5 py-2 text-[13px] text-muted no-underline transition-colors hover:border-[#3a3a3a] hover:text-foreground";

export default async function TeamPage({ params, searchParams }: Props) {
  const { number } = await params;
  const season = parseSeason((await searchParams).season);
  const num = Number(number);
  if (!Number.isInteger(num)) notFound();

  const team = await getTeam(num, season);
  if (!team) notFound();

  const seasons =
    team.activeSeasons.length > 0
      ? [...new Set(team.activeSeasons)].sort((a, b) => b - a)
      : [CURRENT_SEASON];

  const epa = getTeamRanking(season, num);
  const epaTeamCount = getTeamCount(season);
  const traj = getTrajectory(season, num);

  // Live: predicted next match at any ongoing event this team is registered for.
  const ongoing = team.events
    .filter((e) => e.event.ongoing)
    .map((e) => ({ code: e.eventCode, name: e.event.name, type: e.event.type }));
  const nextMatch = ongoing.length
    ? await findNextMatch(season, num, ongoing)
    : null;

  const events = [...team.events].sort(
    (a, b) =>
      eventTypeWeight(a.event.type) - eventTypeWeight(b.event.type) ||
      b.event.start.localeCompare(a.event.start),
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-5 pb-6 pt-10 sm:px-8">
      <LiveRefresh enabled={ongoing.length > 0} />

      {/* Up next (live) */}
      {nextMatch && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-accent/40 bg-accent/[0.06] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Up next
            </span>
            <span className="font-mono text-[15px] font-bold">{nextMatch.label}</span>
            <span className="text-[14px] text-muted">
              ~{formatClock(nextMatch.time, nextMatch.timezone)}
            </span>
          </div>
          <Link
            href={`/events/${season}/${nextMatch.eventCode}`}
            className="text-[13px] text-muted no-underline hover:text-foreground"
          >
            {nextMatch.eventName} →
          </Link>
        </div>
      )}

      {/* Header card */}
      <div className="rounded-[20px] border border-[#1a1a1a] bg-surface px-[30px] py-7">
        <div className="flex flex-wrap items-start justify-between gap-[18px]">
          <div>
            <div className="flex items-center gap-3.5">
              <span
                className="rounded-[10px] px-3 py-1 font-mono text-[20px] font-bold text-accent"
                style={{
                  background: "rgba(205,14,14,0.12)",
                  border: "1px solid rgba(205,14,14,0.3)",
                }}
              >
                {team.number}
              </span>
              <h1 className="m-0 text-[clamp(28px,4vw,40px)] font-semibold tracking-[-0.01em] text-[#f7f8fa]">
                {team.name}
              </h1>
            </div>
            <p className="mt-3.5 text-[14px] text-muted">
              {locationStr(team.location)} · Rookie year {team.rookieYear}
            </p>
            {team.schoolName && (
              <p className="mt-1 text-[14px] text-[#6b6f78]">{team.schoolName}</p>
            )}
          </div>
          <div className="flex gap-2.5">
            {team.website && (
              <a href={team.website} target="_blank" rel="noreferrer" className={OUTLINE_BTN}>
                Website ↗
              </a>
            )}
            <a
              href={`https://ftcscout.org/teams/${team.number}`}
              target="_blank"
              rel="noreferrer"
              className={OUTLINE_BTN}
            >
              FTCScout ↗
            </a>
          </div>
        </div>
      </div>

      {/* Season tabs */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#6b6f78]">
          Season
        </span>
        {seasons.map((s) => (
          <Link
            key={s}
            href={`/teams/${team.number}?season=${s}`}
            className="rounded-[10px] px-3.5 py-2 text-[13px] transition-colors"
            style={
              s === season
                ? { background: "var(--accent)", border: "1px solid var(--accent)", color: "#fff", fontWeight: 500 }
                : { border: "1px solid #232323", color: "#9aa0aa" }
            }
          >
            {seasonLabel(s)}
          </Link>
        ))}
      </div>

      {/* EPA */}
      {epa && (
        <section>
          <div className="mb-3.5 flex items-baseline gap-2.5">
            <h2 className={HEADING}>{seasonFull(season)} — EPA</h2>
            <span className="text-[11px] text-[#6b6f78]">Expected Points Added</span>
          </div>
          <EpaTiles team={epa} teamCount={epaTeamCount} />
        </section>
      )}

      {/* OPR */}
      <section>
        <h2 className={`mb-3.5 ${HEADING}`}>{seasonFull(season)} — OPR</h2>
        {team.quickStats ? (
          <StatTiles stats={team.quickStats} />
        ) : (
          <div className="card p-6 text-center text-sm text-muted">
            No ranked stats for {team.number} in {seasonLabel(season)}.
          </div>
        )}
      </section>

      {/* Trajectory */}
      {traj && traj.points.length > 1 && (
        <section>
          <div className="mb-3.5 flex items-baseline gap-2.5">
            <h2 className={HEADING}>Season Trajectory</h2>
            <span className="text-[11px] text-[#6b6f78]">EPA &amp; OPR per match</span>
          </div>
          <TrajectoryChart points={traj.points} segments={traj.segments} />
        </section>
      )}

      {/* Events */}
      <section>
        <h2 className={`mb-3.5 ${HEADING}`}>Events ({events.length})</h2>
        {events.length === 0 ? (
          <div className="card p-6 text-center text-sm text-muted">
            No events in {seasonLabel(season)}.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
            {events.map((e) => (
              <Link
                key={e.eventCode}
                href={`/events/${season}/${e.eventCode}`}
                className="flex items-center justify-between gap-4 border-t border-[#141414] px-5 py-[15px] no-underline transition-colors first:border-t-0 hover:bg-[#101010]"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-[#e7eaf0]">{e.event.name}</div>
                  <div className="truncate text-[12px] text-[#6b6f78]">
                    {locationStr(e.event.location)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3.5">
                  <span className="rounded-[7px] bg-[#161616] px-[9px] py-[3px] font-mono text-[11px] text-muted">
                    {eventTypeLabel(e.event.type)}
                  </span>
                  <span className="hidden text-[12px] text-[#6b6f78] sm:block">
                    {formatDate(e.event.start)}
                  </span>
                  <span className="text-[#6b6f78]">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Awards */}
      {team.awards.length > 0 && (
        <section>
          <h2 className={`mb-3.5 ${HEADING}`}>Awards ({team.awards.length})</h2>
          <div className="flex flex-wrap gap-2.5">
            {team.awards.map((a, i) => (
              <span
                key={`${a.type}-${a.eventCode}-${i}`}
                className="rounded-[10px] px-3.5 py-2 text-[14px] text-gold"
                style={{
                  border: "1px solid rgba(255,194,75,0.3)",
                  background: "rgba(255,194,75,0.08)",
                }}
              >
                {awardLabel(a.type)}
                {a.placement > 0 ? ` #${a.placement}` : ""}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
