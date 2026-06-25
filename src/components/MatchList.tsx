import Link from "next/link";
import type { Match, MatchTeam } from "@/lib/ftc/types";
import { tournamentLevelLabel } from "@/lib/ftc/labels";
import { formatClock } from "@/lib/format";
import Collapsible from "./Collapsible";

function matchCode(m: Match): string {
  if (m.tournamentLevel === "Quals") return `Q${m.matchNum}`;
  if (m.series > 0) return `M${m.series}-${m.matchNum}`;
  return `${m.matchNum}`;
}

export function matchKey(m: Match): string {
  return `${m.tournamentLevel}-${m.series}-${m.matchNum}`;
}

function AllianceCell({
  teams,
  side,
  won,
  align,
  allianceLabel,
}: {
  teams: MatchTeam[];
  side: "Red" | "Blue";
  won: boolean;
  align: "left" | "right";
  allianceLabel?: string; // e.g. "Alliance 1" (playoff matches)
}) {
  const color = won ? (side === "Red" ? "#ff5d6c" : "#4d8dff") : "#6b6f78";
  return (
    <div
      className={`flex flex-col gap-0.5 ${
        align === "right" ? "items-end text-right" : "items-start text-left"
      }`}
    >
      {allianceLabel && (
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#52565e]">
          {allianceLabel}
        </span>
      )}
      {teams.map((t) => (
        <Link
          key={t.teamNumber}
          href={`/teams/${t.teamNumber}`}
          className="font-mono text-[13px] hover:underline"
          style={{ color, fontWeight: won ? 700 : 400 }}
        >
          {t.teamNumber}
          {t.surrogate ? "*" : ""}
        </Link>
      ))}
    </div>
  );
}

function MatchRow({
  m,
  predicted,
  timezone,
  winProb,
  allianceOf,
}: {
  m: Match;
  predicted?: number;
  timezone?: string;
  winProb?: number; // red win probability 0..1 (unplayed matches)
  allianceOf?: Map<number, number>; // team -> playoff alliance number
}) {
  const red = m.teams
    .filter((t) => t.alliance === "Red")
    .sort((a, b) => a.station.localeCompare(b.station));
  const blue = m.teams
    .filter((t) => t.alliance === "Blue")
    .sort((a, b) => a.station.localeCompare(b.station));

  const redScore = m.scores?.red?.totalPoints ?? null;
  const blueScore = m.scores?.blue?.totalPoints ?? null;
  const played = m.hasBeenPlayed && redScore !== null && blueScore !== null;
  const redWon = played && (redScore as number) > (blueScore as number);
  const blueWon = played && (blueScore as number) > (redScore as number);

  const isPlayoff = m.tournamentLevel !== "Quals";
  const allyLabel = (cell: MatchTeam[]): string | undefined => {
    if (!isPlayoff || !allianceOf) return undefined;
    for (const t of cell) {
      const a = allianceOf.get(t.teamNumber);
      if (a != null) return `Alliance ${a}`;
    }
    return undefined;
  };

  return (
    <div className="grid grid-cols-[48px_1fr] items-center gap-2.5 border-t border-[#141414] px-4 py-[11px] transition-colors first:border-t-0 hover:bg-[#101010]">
      <span className="font-mono text-[12px] text-[#6b6f78]">{matchCode(m)}</span>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <AllianceCell teams={red} side="Red" won={redWon} align="right" allianceLabel={allyLabel(red)} />
        {played ? (
          <div className="flex items-center justify-center gap-1.5 font-mono text-[14px] tabular-nums">
            <span style={{ color: redWon ? "#ff5d6c" : "#6b6f78", fontWeight: redWon ? 700 : 400 }}>
              {redScore}
            </span>
            <span className="text-[#3a3f48]">–</span>
            <span style={{ color: blueWon ? "#4d8dff" : "#6b6f78", fontWeight: blueWon ? 700 : 400 }}>
              {blueScore}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            {winProb != null ? (
              <div
                className="flex items-center gap-1 font-mono text-[12px] tabular-nums"
                title="Predicted win probability"
              >
                <span style={{ color: "#ff5d6c" }}>{Math.round(winProb * 100)}%</span>
                <span className="text-[#3a3f48]">–</span>
                <span style={{ color: "#4d8dff" }}>{Math.round((1 - winProb) * 100)}%</span>
              </div>
            ) : null}
            {predicted != null ? (
              <span className="whitespace-nowrap text-[11px] italic text-[#6b6f78]" title="Predicted start time">
                ~{formatClock(predicted, timezone)}
              </span>
            ) : winProb == null ? (
              <span className="text-[12px] text-[#6b6f78]">vs</span>
            ) : null}
          </div>
        )}
        <AllianceCell teams={blue} side="Blue" won={blueWon} align="left" allianceLabel={allyLabel(blue)} />
      </div>
    </div>
  );
}

export default function MatchList({
  matches,
  predictions,
  winProbs,
  timezone,
  allianceOf,
}: {
  matches: Match[];
  season: number;
  predictions?: Map<string, number>;
  winProbs?: Map<string, number>;
  timezone?: string;
  allianceOf?: Map<number, number>;
}) {
  const withTeams = matches.filter((m) => m.teams.length > 0);

  const groups = new Map<string, Match[]>();
  for (const m of withTeams) {
    const key = m.tournamentLevel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  // Playoffs first, then qualification.
  const order = (k: string) => (k === "Quals" ? 1 : 0);
  const keys = [...groups.keys()].sort((a, b) => order(a) - order(b));

  if (withTeams.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-muted">
        No matches have been posted for this event yet.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {keys.map((k) => {
        const ms = [...groups.get(k)!].sort(
          (a, b) => a.series - b.series || a.matchNum - b.matchNum,
        );
        const rows = (
          <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
            {ms.map((m) => (
              <MatchRow
                key={matchKey(m)}
                m={m}
                predicted={predictions?.get(matchKey(m))}
                winProb={winProbs?.get(matchKey(m))}
                timezone={timezone}
                allianceOf={allianceOf}
              />
            ))}
          </div>
        );
        const label = (
          <>
            {tournamentLevelLabel(k)} <span className="text-[#3a3f48]">({ms.length})</span>
          </>
        );
        // Qualification matches collapse to a dropdown (closed by default) to
        // keep playoffs + results above the fold.
        if (k === "Quals") {
          return (
            <Collapsible
              key={k}
              defaultOpen={false}
              gap="mb-2"
              header={
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">
                  {label}
                </span>
              }
            >
              {rows}
            </Collapsible>
          );
        }
        return (
          <div key={k}>
            <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">
              {label}
            </h3>
            {rows}
          </div>
        );
      })}
    </div>
  );
}
