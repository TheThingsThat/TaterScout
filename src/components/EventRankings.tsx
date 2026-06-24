import Link from "next/link";
import type { EventTeam } from "@/lib/ftc/types";
import type { TeamRanking } from "@/lib/rankings";
import { fmt } from "@/lib/format";

export default function EventRankings({
  teams,
  season,
  epa,
}: {
  teams: EventTeam[];
  season: number;
  epa: Map<number, TeamRanking>;
}) {
  const hasEpa = epa.size > 0;

  const ranked = [...teams].sort((a, b) => {
    if (hasEpa) {
      const ae = epa.get(a.teamNumber)?.epa ?? -Infinity;
      const be = epa.get(b.teamNumber)?.epa ?? -Infinity;
      if (ae !== be) return be - ae;
    }
    const av = a.team.quickStats?.tot.value ?? -Infinity;
    const bv = b.team.quickStats?.tot.value ?? -Infinity;
    return bv - av;
  });

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Team</th>
              {hasEpa && (
                <th className="px-3 py-2.5 text-right font-medium text-accent-2">
                  EPA
                </th>
              )}
              <th className="px-3 py-2.5 text-right font-medium">OPR</th>
              <th className="px-3 py-2.5 text-right font-medium">Auto</th>
              <th className="px-3 py-2.5 text-right font-medium">Tele</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t, i) => {
              const qs = t.team.quickStats;
              const te = epa.get(t.teamNumber);
              return (
                <tr
                  key={t.teamNumber}
                  className="border-b border-border/50 last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5 tabular-nums text-muted">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/teams/${t.teamNumber}?season=${season}`}
                      className="hover:text-accent"
                    >
                      <span className="font-mono text-muted">
                        {t.teamNumber}
                      </span>{" "}
                      <span className="font-medium">{t.team.name}</span>
                    </Link>
                  </td>
                  {hasEpa && (
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-accent-2">
                      {fmt(te?.epa)}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right tabular-nums text-accent">
                    {fmt(qs?.tot.value)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {fmt(qs?.auto.value)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {fmt(qs?.dc.value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2.5 text-[11px] text-muted">
        {hasEpa
          ? "Ranked by season EPA (Expected Points Added). OPR shown alongside."
          : "Ranked by season Total OPR."}
      </p>
    </div>
  );
}
