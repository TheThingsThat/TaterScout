import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTeam } from "@/lib/ftc/queries";
import { CURRENT_SEASON, seasonFull, seasonLabel } from "@/lib/season";
import { eventTypeLabel, eventTypeWeight, awardLabel } from "@/lib/ftc/labels";
import { formatDate, locationStr } from "@/lib/format";
import { getTeamRanking, getTeamCount } from "@/lib/rankings";
import { getTrajectory } from "@/lib/trajectory";
import StatTiles from "@/components/StatTiles";
import EpaTiles from "@/components/EpaTiles";
import TrajectoryChart from "@/components/TrajectoryChart";

interface Props {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ season?: string }>;
}

function parseSeason(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 2018 ? n : CURRENT_SEASON;
}

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { number } = await params;
  try {
    const team = await getTeam(Number(number), CURRENT_SEASON);
    if (team) {
      return { title: `${team.number} ${team.name}` };
    }
  } catch {
    /* ignore */
  }
  return { title: `Team ${number}` };
}

export default async function TeamPage({ params, searchParams }: Props) {
  const { number } = await params;
  const season = parseSeason((await searchParams).season);
  const num = Number(number);
  if (!Number.isInteger(num)) notFound();

  const team = await getTeam(num, season);
  if (!team) notFound();

  // The API can return duplicate seasons (e.g. 2025 twice), so de-dupe.
  const seasons =
    team.activeSeasons.length > 0
      ? [...new Set(team.activeSeasons)].sort((a, b) => b - a)
      : [CURRENT_SEASON];

  const epa = getTeamRanking(season, num);
  const epaTeamCount = getTeamCount(season);
  const traj = getTrajectory(season, num);

  const events = [...team.events].sort(
    (a, b) =>
      eventTypeWeight(a.event.type) - eventTypeWeight(b.event.type) ||
      b.event.start.localeCompare(a.event.start),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-lg font-bold text-accent">
                {team.number}
              </span>
              <h1 className="text-2xl font-bold tracking-tight">{team.name}</h1>
            </div>
            <p className="mt-2 text-sm text-muted">
              {locationStr(team.location)} · Rookie year {team.rookieYear}
            </p>
            {team.schoolName && (
              <p className="text-sm text-muted">{team.schoolName}</p>
            )}
          </div>
          <div className="flex gap-2 text-sm">
            {team.website && (
              <a
                href={team.website}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-foreground"
              >
                Website ↗
              </a>
            )}
            <a
              href={`https://ftcscout.org/teams/${team.number}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-foreground"
            >
              FTCScout ↗
            </a>
          </div>
        </div>
      </div>

      {/* Season tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs uppercase tracking-wide text-muted">
          Season
        </span>
        {seasons.map((s) => (
          <Link
            key={s}
            href={`/teams/${team.number}?season=${s}`}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              s === season
                ? "bg-accent text-background font-medium"
                : "border border-border text-muted hover:text-foreground"
            }`}
          >
            {seasonLabel(s)}
          </Link>
        ))}
      </div>

      {/* EPA */}
      {epa && (
        <section>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {seasonFull(season)} — EPA
            </h2>
            <span className="text-[11px] text-muted">
              Expected Points Added
            </span>
          </div>
          <EpaTiles team={epa} teamCount={epaTeamCount} />
        </section>
      )}

      {/* Stats */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {seasonFull(season)} — OPR
        </h2>
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
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Season Trajectory
            </h2>
            <span className="text-[11px] text-muted">
              EPA &amp; OPR per match
            </span>
          </div>
          <TrajectoryChart points={traj.points} segments={traj.segments} />
        </section>
      )}

      {/* Events */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Events ({events.length})
        </h2>
        {events.length === 0 ? (
          <div className="card p-6 text-center text-sm text-muted">
            No events in {seasonLabel(season)}.
          </div>
        ) : (
          <div className="card divide-y divide-border overflow-hidden">
            {events.map((e) => (
              <Link
                key={e.eventCode}
                href={`/events/${season}/${e.eventCode}`}
                className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{e.event.name}</div>
                  <div className="truncate text-xs text-muted">
                    {locationStr(e.event.location)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                    {eventTypeLabel(e.event.type)}
                  </span>
                  <span className="hidden text-xs text-muted sm:block">
                    {formatDate(e.event.start)}
                  </span>
                  <span className="text-muted">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Awards */}
      {team.awards.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Awards ({team.awards.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {team.awards.map((a, i) => (
              <span
                key={`${a.type}-${a.eventCode}-${i}`}
                className="rounded-lg border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm text-gold"
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
