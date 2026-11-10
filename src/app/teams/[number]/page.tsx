import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import type { Metadata } from "next";
import { getTeam, getEventMatches, getTeamEventRank, recordOf } from "@/lib/ftc/queries";
import {
  CURRENT_SEASON,
  allSeasons,
  pastSeasons,
  seasonFull,
  seasonLabel,
  parseSeasonParam,
  ratingsCoverageNote,
} from "@/lib/season";
import { formatAward } from "@/lib/ftc/labels";
import { fmt, locationStr } from "@/lib/format";
import { getTeamRanking, getTeamCount, getSeasonCyclePrior } from "@/lib/rankings";
import { siteTeamRow } from "@/lib/data/convexSite";
import { getEventStats } from "@/lib/eventStats";
import { getTrajectory } from "@/lib/trajectory";
import type { Match, QuickStats, Team, TeamEventLite } from "@/lib/ftc/types";
import { scheduleAutoRefresh } from "@/lib/data/autoRefresh";
import { predictMatchTimes, FTC_DEFAULTS, type SchedMatch } from "@/lib/predict/matchTimes";
import StatTiles from "@/components/StatTiles";
import EpaTiles from "@/components/EpaTiles";
import TrajectoryChart from "@/components/TrajectoryChart";
import LiveRefresh from "@/components/LiveRefresh";
import LocalClock from "@/components/LocalClock";
import TeamEventCard from "@/components/TeamEventCard";
import StarButton from "@/components/StarButton";
import { matchKey } from "@/components/MatchList";

interface NextMatch {
  label: string;
  time: number | null;
  timezone: string;
  eventName: string;
  eventCode: string;
}

/** Predicted start times for the unplayed quals at each ongoing event. */
async function predictOngoing(
  season: number,
  ongoing: { event: TeamEventLite["event"]; matches: Match[] }[],
): Promise<Map<string, Map<string, number>>> {
  // Cycle priors hoisted out of the loop: one cached lookup per event TYPE.
  const types = [...new Set(ongoing.map((e) => e.event.type))];
  const priors = await Promise.all(types.map((t) => getSeasonCyclePrior(season, t)));
  const priorByType = new Map(types.map((t, i) => [t, priors[i]]));
  const out = new Map<string, Map<string, number>>();
  for (const { event, matches } of ongoing) {
    const sched: SchedMatch[] = matches
      .filter((m) => m.tournamentLevel === "Quals")
      .map((m) => ({
        key: matchKey(m),
        scheduled: m.scheduledStartTime ? Date.parse(m.scheduledStartTime) : null,
        actual: m.actualStartTime ? Date.parse(m.actualStartTime) : null,
        played: m.hasBeenPlayed,
      }));
    const { predicted } = predictMatchTimes(sched, {
      ...FTC_DEFAULTS,
      seasonPriorSec: priorByType.get(event.type)!,
    });
    out.set(event.code, predicted);
  }
  return out;
}

function findNextMatch(
  num: number,
  ongoing: { event: TeamEventLite["event"]; matches: Match[] }[],
  predictions: Map<string, Map<string, number>>,
): NextMatch | null {
  let best: NextMatch | null = null;
  for (const { event, matches } of ongoing) {
    const predicted = predictions.get(event.code);
    const mine = matches
      .filter(
        (m) =>
          m.tournamentLevel === "Quals" &&
          !m.hasBeenPlayed &&
          m.teams.some((t) => t.teamNumber === num),
      )
      .map((m) => ({ m, t: predicted?.get(matchKey(m)) ?? null }))
      .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
    if (mine.length) {
      const top = mine[0];
      if (best === null || (top.t ?? Infinity) < (best.time ?? Infinity)) {
        best = {
          label: `Q${top.m.matchNum}`,
          time: top.t,
          timezone: event.timezone,
          eventName: event.name,
          eventCode: event.code,
        };
      }
    }
  }
  return best;
}

interface Props {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ season?: string }>;
}

// Clamp to seasons we have data for — this drives dataset reads and FIRST calls.
const parseSeason = parseSeasonParam;

/** Seasons we have data for, newest first, from the team's rookie year on. */
const seasonsSince = (rookieYear: number) => allSeasons().filter((s) => s >= rookieYear);

/** FTC team numbers are 1–5 digits; anything else would only cost FIRST calls. */
const isTeamNumber = (n: number) => Number.isInteger(n) && n >= 1 && n <= 99999;

/** Past seasons we hold a ranking row for this team in. Cached 15 minutes, not-founds
 *  included, so an unknown or long-retired number doesn't cost a Convex read per past
 *  season on every request. A Convex outage throws, so it's never cached. */
const rowSeasons = unstable_cache(
  async (num: number): Promise<number[]> => {
    const out: number[] = [];
    for (const s of pastSeasons()) {
      const r = await siteTeamRow(s, num);
      if (r === null) throw new Error("Convex unavailable");
      if (r.v) out.push(s);
    }
    return out;
  },
  ["team-row-seasons"],
  { revalidate: 900 },
);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { number } = await params;
  const season = parseSeason((await searchParams).season);
  const num = Number(number);
  if (!isTeamNumber(num)) return { title: `Team ${number}` };
  try {
    // The page's own first lookups, so the request memo makes this free.
    const team =
      (await getTeam(num, season)) ?? (season === CURRENT_SEASON ? null : await getTeam(num, CURRENT_SEASON));
    if (team) return { title: `${team.number} ${team.name}` };
  } catch {
    /* ignore */
  }
  return { title: `Team ${number}` };
}

const HEADING = "font-mono text-[11px] uppercase tracking-[0.14em] text-muted";
const OUTLINE_BTN =
  "rounded-[10px] border border-[#232323] px-3.5 py-2 text-[13px] text-muted no-underline transition-colors hover:border-[#3a3a3a] hover:text-foreground";

/** The banner: number, name, location, and the star / website / FTCScout buttons. */
function TeamHeader({ team }: { team: Team }) {
  return (
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
            {locationStr(team.location)}
            {team.rookieYear > 0 ? ` · Rookie year ${team.rookieYear}` : ""}
          </p>
          {team.schoolName && (
            <p className="mt-1 text-[14px] text-[#6b6f78]">{team.schoolName}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2.5">
          <StarButton team={team.number} />
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
  );
}

/** Seasons the team could have played since its rookie year; `children` sits on the right. */
function SeasonTabs({
  team,
  seasons,
  season,
  children,
}: {
  team: number;
  seasons: number[];
  season: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#6b6f78]">Season</span>
      {seasons.map((s) => (
        <Link
          key={s}
          prefetch={false}
          href={s === CURRENT_SEASON ? `/teams/${team}` : `/teams/${team}?season=${s}`}
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
      {children}
    </div>
  );
}

export default async function TeamPage({ params, searchParams }: Props) {
  const { number } = await params;
  const season = parseSeason((await searchParams).season);
  const num = Number(number);
  if (!isTeamNumber(num)) notFound();

  scheduleAutoRefresh(season); // post-response staleness check (never blocks)

  const team = await getTeam(num, season);
  if (!team) {
    // Not registered that season: show the team from its newest season we know, with
    // tabs to the rest. A past season costs FIRST calls only once our cached ranking
    // row shows the team played it.
    const known = await rowSeasons(num).catch(() => [] as number[]);
    let current: Team | null = null;
    for (const s of allSeasons()) {
      if (s === season) continue;
      if (s !== CURRENT_SEASON && !known.includes(s)) continue;
      current = await getTeam(num, s);
      if (current) break;
    }
    if (!current) notFound();
    return (
      <div className="mx-auto max-w-[1100px] space-y-6 px-5 pb-6 pt-10 sm:px-8">
        <TeamHeader team={current} />
        <SeasonTabs team={num} seasons={seasonsSince(current.rookieYear)} season={season} />
        <div className="card p-6 text-center text-sm text-muted">
          Team {num} didn&apos;t compete in {seasonFull(season)}.
        </div>
      </div>
    );
  }

  const seasons = seasonsSince(team.rookieYear);

  // The Convex reads and the per-event FIRST fetches don't depend on each other: run
  // them together. Events are chronological, most recent first: everything FIRST
  // knows about the team at each, fetched through the event pages' caches.
  const [[epa, epaTeamCount, traj], events] = await Promise.all([
    Promise.all([getTeamRanking(season, num), getTeamCount(season), getTrajectory(season, num)]),
    Promise.all(
      [...team.events]
        .sort((a, b) => b.event.start.localeCompare(a.event.start))
        .map(async ({ event }) => {
          const matches = await getEventMatches(season, event.code, event.timezone, event.end).catch(
            () => [] as Match[],
          );
          const mine = matches.filter((m) => m.teams.some((t) => t.teamNumber === num));
          // Until the team has played here, FIRST's rank is just its default ordering (or,
          // at a League Meet, standing from earlier meets) and no stats row exists.
          const played = mine.some((m) => m.hasBeenPlayed);
          const [rank, stats] = played
            ? await Promise.all([
                getTeamEventRank(season, event.code, num, event.timezone, event.end).catch(() => null),
                getEventStats(season, event.code, event.end),
              ])
            : [null, null];
          return { event, matches, mine, rank, stat: stats?.get(num) ?? null, record: recordOf(mine, num) };
        }),
    ),
  ]);

  // Season OPR tiles come from our own store (FIRST has no season OPR). Endgame
  // is folded into TeleOp, so only three tiles show.
  const oprStats: QuickStats | null =
    epa && epa.oprNp != null
      ? {
          season,
          number: num,
          count: epaTeamCount,
          tot: { value: epa.oprNp, rank: epa.rkOprNp ?? 0 },
          auto: { value: epa.oprAuto ?? 0, rank: epa.rkOprAuto ?? 0 },
          dc: { value: epa.oprTele ?? 0, rank: epa.rkOprTele ?? 0 },
        }
      : null;

  // Live: predicted next match at any ongoing event this team is registered for.
  const ongoing = events.filter((e) => e.event.ongoing);
  const predictions = await predictOngoing(season, ongoing);
  const nextMatch = findNextMatch(num, ongoing, predictions);

  // Season record across every match played this season — quals and playoffs.
  const record = events.reduce(
    (sum, e) => ({
      wins: sum.wins + e.record.wins,
      losses: sum.losses + e.record.losses,
      ties: sum.ties + e.record.ties,
    }),
    { wins: 0, losses: 0, ties: 0 },
  );
  const recordGames = record.wins + record.losses + record.ties;
  const latestPlayed = events.findIndex((e) => e.mine.some((m) => m.hasBeenPlayed));

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
              ~<LocalClock ms={nextMatch.time} fallbackTimezone={nextMatch.timezone} />
            </span>
          </div>
          <Link
            prefetch={false}
            href={`/events/${season}/${nextMatch.eventCode}`}
            className="text-[13px] text-muted no-underline hover:text-foreground"
          >
            {nextMatch.eventName} →
          </Link>
        </div>
      )}

      <TeamHeader team={team} />
      <SeasonTabs team={team.number} seasons={seasons} season={season}>
        {recordGames > 0 && (
          <span className="ml-auto flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6b6f78]">
              {record.ties > 0 ? "W-L-T" : "W-L"}
            </span>
            <span className="text-[15px] font-semibold tabular-nums text-[#f7f8fa]">
              {record.wins}–{record.losses}
              {record.ties > 0 ? `–${record.ties}` : ""}
            </span>
          </span>
        )}
      </SeasonTabs>

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

      {/* Hive tips (count EPA, BIOBUZZ) */}
      {epa && (epa.tipsAuto != null || epa.tipsTele != null) && (
        <section>
          <div className="mb-3.5 flex items-baseline gap-2.5">
            <h2 className={HEADING}>Hive tips</h2>
            <span className="text-[11px] text-[#6b6f78]">
              expected per match, this robot alone
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            {[
              ["Auto tips", epa.tipsAuto],
              ["TeleOp tips", epa.tipsTele],
            ].map(([label, v]) => (
              <div key={label} className="rounded-2xl border border-[#1a1a1a] bg-surface p-[18px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{label}</span>
                <div className="mt-2.5 text-[26px] font-bold tabular-nums" style={{ color: "var(--epa)" }}>
                  {fmt(v as number | null, 2)}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#6b6f78]">
            FIRST counts tips per alliance, so each robot&apos;s share is estimated the way EPA splits points.
          </p>
        </section>
      )}

      {/* OPR */}
      <section>
        <h2 className={`mb-3.5 ${HEADING}`}>{seasonFull(season)} — OPR</h2>
        {oprStats ? (
          <StatTiles stats={oprStats} />
        ) : (
          <div className="card p-6 text-center text-sm text-muted">
            No ranked stats for {team.number} in {seasonLabel(season)}.
            {ratingsCoverageNote(season) ? ` ${ratingsCoverageNote(season)}` : ""}
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
          <div className="space-y-3.5">
            {events.map((e, i) => (
              <TeamEventCard
                key={e.event.code}
                season={season}
                teamNumber={num}
                event={e.event}
                matches={e.mine}
                predictions={predictions.get(e.event.code)}
                rank={e.rank}
                stat={e.stat}
                record={e.record}
                defaultOpen={e.event.ongoing || i === latestPlayed}
              />
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
              <div
                key={`${a.type}-${a.eventCode}-${i}`}
                className="rounded-[10px] px-3.5 py-2.5 text-gold"
                style={{
                  border: "1px solid rgba(255,194,75,0.3)",
                  background: "rgba(255,194,75,0.08)",
                }}
              >
                <div className="text-[14px] font-medium">{formatAward(a.type, a.placement)}</div>
                <Link
                  prefetch={false}
                  href={`/events/${season}/${a.eventCode}`}
                  className="mt-0.5 block max-w-[220px] truncate text-[12px] text-[#b89a52] no-underline hover:text-gold"
                  title={a.event?.name ?? a.eventCode}
                >
                  {a.event?.name ?? a.eventCode}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
