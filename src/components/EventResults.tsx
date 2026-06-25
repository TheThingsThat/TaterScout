import Link from "next/link";

export interface ResultTeam {
  number: number;
  name: string;
}

function Row({
  label,
  accent,
  bg,
  teams,
  captainTag,
  season,
}: {
  label: string;
  accent: string;
  bg: string;
  teams: ResultTeam[];
  captainTag?: string; // marks the alliance captain (teams[0])
  season: number;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span
        className="mt-px shrink-0 rounded-[6px] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: accent, background: bg }}
      >
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        {teams.map((t, i) => {
          const captain = i === 0 && !!captainTag;
          return (
            <Link
              key={t.number}
              href={`/teams/${t.number}?season=${season}`}
              className="no-underline hover:text-foreground"
              style={{ color: captain ? accent : "#9aa0aa", fontWeight: captain ? 600 : 400 }}
            >
              <span className="font-mono text-[12px] opacity-70">{t.number}</span> {t.name}
              {captain && (
                <span
                  className="ml-1 rounded px-1 py-px font-mono text-[9px] font-bold uppercase"
                  style={{ background: bg, color: accent }}
                >
                  {captainTag}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function EventResults({
  winner,
  finalist,
  inspire,
  season,
}: {
  winner: ResultTeam[];
  finalist: ResultTeam[];
  inspire: ResultTeam | null;
  season: number;
}) {
  return (
    <div className="divide-y divide-[#141414] overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      {winner.length > 0 && (
        <Row label="Winner" accent="#ffc24b" bg="rgba(255,194,75,0.12)" teams={winner} captainTag="WAC" season={season} />
      )}
      {finalist.length > 0 && (
        <Row label="Finalist" accent="#b6bcc6" bg="rgba(182,188,198,0.1)" teams={finalist} captainTag="FAC" season={season} />
      )}
      {inspire && (
        <Row label="Inspire" accent="#ff5d6c" bg="rgba(205,14,14,0.14)" teams={[inspire]} season={season} />
      )}
    </div>
  );
}
