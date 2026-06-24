import Link from "next/link";
import type { Match, MatchTeam } from "@/lib/ftc/types";
import { tournamentLevelLabel } from "@/lib/ftc/labels";

function matchCode(m: Match): string {
  if (m.tournamentLevel === "Quals") return `Q${m.matchNum}`;
  if (m.series > 0) return `M${m.series}-${m.matchNum}`;
  return `${m.matchNum}`;
}

function AllianceCell({
  teams,
  side,
  won,
  align,
}: {
  teams: MatchTeam[];
  side: "Red" | "Blue";
  won: boolean;
  align: "left" | "right";
}) {
  const color = side === "Red" ? "text-red" : "text-blue";
  return (
    <div
      className={`flex flex-col gap-0.5 ${
        align === "right" ? "items-end text-right" : "items-start text-left"
      }`}
    >
      {teams.map((t) => (
        <Link
          key={t.teamNumber}
          href={`/teams/${t.teamNumber}`}
          className={`font-mono text-sm hover:underline ${
            won ? color : "text-muted"
          } ${won ? "font-semibold" : ""}`}
        >
          {t.teamNumber}
          {t.surrogate ? "*" : ""}
        </Link>
      ))}
    </div>
  );
}

function MatchRow({ m, season }: { m: Match; season: number }) {
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

  void season;

  return (
    <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2 px-4 py-2.5 hover:bg-surface-2">
      <span className="font-mono text-xs text-muted">{matchCode(m)}</span>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <AllianceCell teams={red} side="Red" won={redWon} align="right" />
        <div className="flex items-center gap-1.5 font-mono text-sm tabular-nums">
          {played ? (
            <>
              <span className={redWon ? "font-bold text-red" : "text-muted"}>
                {redScore}
              </span>
              <span className="text-border">–</span>
              <span className={blueWon ? "font-bold text-blue" : "text-muted"}>
                {blueScore}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted">vs</span>
          )}
        </div>
        <AllianceCell teams={blue} side="Blue" won={blueWon} align="left" />
      </div>
    </div>
  );
}

export default function MatchList({
  matches,
  season,
}: {
  matches: Match[];
  season: number;
}) {
  const withTeams = matches.filter((m) => m.teams.length > 0);

  const groups = new Map<string, Match[]>();
  for (const m of withTeams) {
    const key = m.tournamentLevel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  // Quals first, then everything else.
  const order = (k: string) => (k === "Quals" ? 0 : 1);
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
        return (
          <div key={k}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {tournamentLevelLabel(k)}{" "}
              <span className="text-border">({ms.length})</span>
            </h3>
            <div className="card divide-y divide-border/50 overflow-hidden">
              {ms.map((m) => (
                <MatchRow key={`${m.tournamentLevel}-${m.series}-${m.matchNum}`} m={m} season={season} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
