import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getEvent } from "@/lib/ftc/queries";
import { seasonFull } from "@/lib/season";
import { eventTypeLabel } from "@/lib/ftc/labels";
import { getRankingMap, getSeasonCyclePrior, getSimModel } from "@/lib/rankings";
import { getEventStats } from "@/lib/eventStats";
import { formatDate, locationStr } from "@/lib/format";
import EventRankings from "@/components/EventRankings";
import MatchList, { matchKey } from "@/components/MatchList";
import LiveRefresh from "@/components/LiveRefresh";
import EventPredictions from "@/components/EventPredictions";
import PredictScheduleToggle from "@/components/PredictScheduleToggle";
import EventSos from "@/components/EventSos";
import EventResults, { type ResultTeam } from "@/components/EventResults";
import Collapsible from "@/components/Collapsible";
import { deriveAllianceNumbers } from "@/lib/ftc/alliances";
import { predictMatchTimes, FTC_DEFAULTS, type SchedMatch } from "@/lib/predict/matchTimes";
import { simulateEvent, type SimTeam } from "@/lib/predict/simulate";
import { computeSos } from "@/lib/predict/sos";
import { winProb } from "@/lib/predict/model";
import type { SchedMatchIdx } from "@/lib/predict/schedule";

interface Props {
  params: Promise<{ season: string; code: string }>;
  searchParams: Promise<{ sched?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season, code } = await params;
  try {
    const ev = await getEvent(Number(season), code);
    if (ev) return { title: ev.name };
  } catch {
    /* ignore */
  }
  return { title: `Event ${code}` };
}

const HEADING = "mb-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted";
const OUTLINE_BTN =
  "rounded-[10px] border border-[#232323] px-3.5 py-2 text-[13px] text-muted no-underline transition-colors hover:border-[#3a3a3a] hover:text-foreground";

function StatusBadge({ ongoing, finished }: { ongoing: boolean; finished: boolean }) {
  if (ongoing)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-teal/15 px-[11px] py-1 text-[11px] font-semibold text-teal">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
        Live
      </span>
    );
  return (
    <span className="rounded-full bg-[#161616] px-[11px] py-1 text-[11px] font-semibold text-muted">
      {finished ? "Finished" : "Upcoming"}
    </span>
  );
}

export default async function EventPage({ params, searchParams }: Props) {
  const { season: seasonStr, code } = await params;
  const season = Number(seasonStr);
  if (!Number.isInteger(season)) notFound();

  const ev = await getEvent(season, code);
  if (!ev) notFound();

  const epaMap = getRankingMap(season, ev.teams.map((t) => t.teamNumber));
  // Time-aware ratings for THIS event: pre-event EPA (seeds the simulation,
  // no lookahead) and post-event EPA/OPR (shown in the rankings table).
  const evStats = getEventStats(season, code);

  // --- Event prediction (Monte-Carlo) ---
  const model = getSimModel(season);
  const teamNums = ev.teams.map((t) => t.teamNumber);
  const idxOf = new Map(teamNums.map((n, i) => [n, i]));
  // Pre-event EPA going into this event; fall back to season EPA for teams or
  // events missing from the precomputed snapshot (e.g. a live/unfinished event).
  const preEpaOf = (n: number): number =>
    evStats.get(n)?.preEpa ?? epaMap.get(n)?.epa ?? 0;
  // Post-event EPA (rating leaving the event) for the realized-difficulty SoS.
  const postEpaOf = (n: number): number =>
    evStats.get(n)?.epa ?? epaMap.get(n)?.epa ?? 0;
  const simTeams: SimTeam[] = teamNums.map((n) => ({
    number: n,
    epa: preEpaOf(n),
  }));

  const realSchedule: SchedMatchIdx[] = [];
  for (const m of ev.matches) {
    if (m.tournamentLevel !== "Quals") continue;
    const red = m.teams.filter((t) => t.alliance === "Red").map((t) => idxOf.get(t.teamNumber));
    const blue = m.teams.filter((t) => t.alliance === "Blue").map((t) => idxOf.get(t.teamNumber));
    if (red.length === 2 && blue.length === 2 && [...red, ...blue].every((x) => x != null)) {
      realSchedule.push([red[0]!, red[1]!, blue[0]!, blue[1]!]);
    }
  }
  const realAvailable = realSchedule.length > 0;
  const matchesPerTeam = realAvailable
    ? Math.max(1, Math.round((realSchedule.length * 4) / Math.max(1, teamNums.length)))
    : 5;

  const po = ev.matches.filter((m) => m.tournamentLevel !== "Quals");
  const captains = new Set(
    po.flatMap((m) => m.teams).filter((t) => t.allianceRole === "Captain").map((t) => t.teamNumber),
  );
  const allianceCount = captains.size || undefined;
  const allianceSize = po.some((m) => m.teams.some((t) => t.allianceRole === "SecondPick"))
    ? 3
    : allianceCount
      ? 2
      : undefined;

  const schedParam = (await searchParams).sched;
  const mode: "real" | "sim" =
    schedParam === "sim" ? "sim" : schedParam === "real" ? "real" : realAvailable ? "real" : "sim";
  const canPredict = simTeams.length >= 6 && simTeams.some((t) => t.epa > 0);
  const simResult = canPredict
    ? simulateEvent({
        teams: simTeams,
        model,
        matchesPerTeam,
        realSchedule: mode === "real" && realAvailable ? realSchedule : undefined,
        allianceCount,
        allianceSize,
        iters: teamNums.length > 80 ? 1200 : 3000,
        seed: 0x51ed51ed,
      })
    : null;

  // Per-match win probabilities for unplayed matches.
  const winProbs = new Map<string, number>();
  for (const m of ev.matches) {
    if (m.hasBeenPlayed) continue;
    const red = m.teams.filter((t) => t.alliance === "Red");
    const blue = m.teams.filter((t) => t.alliance === "Blue");
    if (!red.length || !blue.length) continue;
    const rE = red.reduce((s, t) => s + preEpaOf(t.teamNumber), 0);
    const bE = blue.reduce((s, t) => s + preEpaOf(t.teamNumber), 0);
    if (rE === 0 && bE === 0) continue;
    winProbs.set(matchKey(m), winProb(rE, bE, model.marginSd));
  }

  // --- Strength of schedule (Statbotics-style; needs a released real schedule) ---
  const canSos = realAvailable && teamNums.length >= 6;
  const sosPre = canSos
    ? computeSos({ teams: teamNums, epaOf: (i) => preEpaOf(teamNums[i]), actualSchedule: realSchedule, model, matchesPerTeam, seed: 0x50505050 })
    : null;
  const sosPost = canSos
    ? computeSos({ teams: teamNums, epaOf: (i) => postEpaOf(teamNums[i]), actualSchedule: realSchedule, model, matchesPerTeam, seed: 0x50505050 })
    : null;

  // --- Playoff alliance numbers (derived) for the match list ---
  const rankOf = new Map<number, number>();
  for (const t of ev.teams) {
    if (t.stats?.rank != null) rankOf.set(t.teamNumber, t.stats.rank);
  }
  const allianceOf = deriveAllianceNumbers(ev.matches, rankOf);

  // --- Results (from event awards): winning/finalist alliance + Inspire ---
  const nameOf = new Map(ev.teams.map((t) => [t.teamNumber, t.team.name]));
  const teamList = (type: string): ResultTeam[] =>
    ev.awards
      .filter((a) => a.type === type && a.teamNumber != null)
      .sort((a, b) => a.placement - b.placement)
      .map((a) => ({ number: a.teamNumber!, name: nameOf.get(a.teamNumber!) ?? `Team ${a.teamNumber}` }));
  const winnerTeams = teamList("Winner");
  const finalistTeams = teamList("Finalist");
  const inspireAward = ev.awards.find((a) => a.type === "Inspire" && a.placement === 1 && a.teamNumber != null);
  const inspireTeam: ResultTeam | null = inspireAward
    ? { number: inspireAward.teamNumber!, name: nameOf.get(inspireAward.teamNumber!) ?? `Team ${inspireAward.teamNumber}` }
    : null;
  const hasResults = winnerTeams.length > 0 || finalistTeams.length > 0 || inspireTeam !== null;

  // Predicted start times for unplayed qualification matches (TBA-style).
  const qualSched: SchedMatch[] = ev.matches
    .filter((m) => m.tournamentLevel === "Quals")
    .map((m) => ({
      key: matchKey(m),
      scheduled: m.scheduledStartTime ? Date.parse(m.scheduledStartTime) : null,
      actual: m.actualStartTime ? Date.parse(m.actualStartTime) : null,
      played: m.hasBeenPlayed,
    }));
  const { predicted } = predictMatchTimes(qualSched, {
    ...FTC_DEFAULTS,
    seasonPriorSec: getSeasonCyclePrior(season, ev.type),
  });

  const dateRange =
    ev.start === ev.end
      ? formatDate(ev.start)
      : `${formatDate(ev.start)} – ${formatDate(ev.end)}`;

  return (
    <div className="mx-auto max-w-[1240px] space-y-7 px-5 pb-6 pt-10 sm:px-8">
      <LiveRefresh enabled={ev.ongoing} />
      {/* Header card */}
      <div className="rounded-[20px] border border-[#1a1a1a] bg-surface px-[30px] py-7">
        <div className="flex flex-wrap items-start justify-between gap-[18px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-[7px] bg-[#161616] px-2.5 py-[3px] font-mono text-[11px] text-muted">
                {eventTypeLabel(ev.type)}
              </span>
              <StatusBadge ongoing={ev.ongoing} finished={ev.finished} />
              {ev.remote && (
                <span className="rounded-[7px] bg-[#161616] px-2.5 py-[3px] font-mono text-[11px] text-muted">
                  Remote
                </span>
              )}
            </div>
            <h1 className="mt-3.5 text-[clamp(26px,3.6vw,38px)] font-semibold tracking-[-0.01em] text-[#f7f8fa]">
              {ev.name}
            </h1>
            <p className="mt-2 text-[14px] text-muted">
              {seasonFull(season)} · {dateRange} · {locationStr(ev.location)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2.5">
            {ev.website && (
              <a href={ev.website} target="_blank" rel="noreferrer" className={OUTLINE_BTN}>
                Website ↗
              </a>
            )}
            {ev.liveStreamURL && (
              <a
                href={ev.liveStreamURL}
                target="_blank"
                rel="noreferrer"
                className="rounded-[10px] border border-accent/40 bg-accent/[0.08] px-3.5 py-2 text-[13px] text-accent no-underline transition-colors hover:bg-accent/[0.14]"
              >
                ▶ Livestream
              </a>
            )}
            <a
              href={`https://ftcscout.org/events/${season}/${ev.code}`}
              target="_blank"
              rel="noreferrer"
              className={OUTLINE_BTN}
            >
              FTCScout ↗
            </a>
          </div>
        </div>
        <div className="mt-5 flex gap-7 text-[14px]">
          <div>
            <span className="text-[#6b6f78]">Teams</span>{" "}
            <span className="font-mono font-semibold">{ev.teams.length}</span>
          </div>
          <div>
            <span className="text-[#6b6f78]">Matches</span>{" "}
            <span className="font-mono font-semibold">
              {ev.matches.filter((m) => m.teams.length > 0).length}
            </span>
          </div>
        </div>
      </div>

      {simResult && (
        <Collapsible
          defaultOpen={false}
          header={
            <span className="flex items-baseline gap-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Predictions
              </span>
              <span className="text-[11px] text-[#6b6f78]">win odds, seeds &amp; playoffs</span>
            </span>
          }
          right={<PredictScheduleToggle value={mode} realAvailable={realAvailable} />}
        >
          <EventPredictions result={simResult} season={season} />
        </Collapsible>
      )}

      {sosPre && sosPost && sosPre.teams.length > 0 && (
        <Collapsible
          defaultOpen={false}
          header={
            <span className="flex items-baseline gap-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Strength of Schedule
              </span>
              <span className="text-[11px] text-[#6b6f78]">how lucky was the draw</span>
            </span>
          }
        >
          <EventSos pre={sosPre} post={sosPost} season={season} />
        </Collapsible>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section>
          <h2 className={HEADING}>Rankings</h2>
          {ev.teams.length > 0 ? (
            <EventRankings teams={ev.teams} season={season} stats={evStats} epa={epaMap} />
          ) : (
            <div className="card p-6 text-center text-sm text-muted">
              No team list available.
            </div>
          )}
        </section>

        <section className="space-y-6">
          {hasResults && (
            <div>
              <h2 className={HEADING}>Results</h2>
              <EventResults
                winner={winnerTeams}
                finalist={finalistTeams}
                inspire={inspireTeam}
                season={season}
              />
            </div>
          )}
          <div>
            <h2 className={HEADING}>Matches</h2>
            <MatchList
              matches={ev.matches}
              season={season}
              predictions={predicted}
              winProbs={winProbs}
              timezone={ev.timezone}
              allianceOf={allianceOf}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
