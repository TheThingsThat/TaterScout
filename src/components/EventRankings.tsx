import Link from "next/link";
import type { EventTeam } from "@/lib/ftc/types";
import type { TeamRanking } from "@/lib/rankings";
import { fmt } from "@/lib/format";

const TH =
  "px-2.5 py-3 text-right font-mono text-[10px] font-bold uppercase tracking-[0.1em]";

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
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      <div className="ts-scroll overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#1f1f1f]">
              <th className="px-3.5 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">
                #
              </th>
              <th className="px-3.5 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">
                Team
              </th>
              {hasEpa && (
                <th className={TH} style={{ color: "#2f8bff" }}>
                  EPA
                </th>
              )}
              <th className={TH} style={{ color: "#3ecf76" }}>
                OPR
              </th>
              <th className={TH} style={{ color: "#6b6f78" }}>
                Auto
              </th>
              <th className={TH} style={{ color: "#6b6f78" }}>
                Tele
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t, i) => {
              const qs = t.team.quickStats;
              const te = epa.get(t.teamNumber);
              return (
                <tr
                  key={t.teamNumber}
                  className="border-b border-[#141414] transition-colors last:border-0 hover:bg-[#101010]"
                >
                  <td className="px-3.5 py-2.5 font-mono text-[#6b6f78]">{i + 1}</td>
                  <td className="px-3.5 py-2.5">
                    <Link
                      href={`/teams/${t.teamNumber}?season=${season}`}
                      className="no-underline hover:text-accent"
                    >
                      <span className="font-mono text-[#6b6f78]">{t.teamNumber}</span>{" "}
                      <span className="font-medium text-[#e7eaf0]">{t.team.name}</span>
                    </Link>
                  </td>
                  {hasEpa && (
                    <td className="px-2.5 py-2.5 text-right font-semibold tabular-nums" style={{ color: "#2f8bff" }}>
                      {fmt(te?.epa)}
                    </td>
                  )}
                  <td className="px-2.5 py-2.5 text-right tabular-nums" style={{ color: "#3ecf76" }}>
                    {fmt(qs?.tot.value)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-[#6b6f78]">
                    {fmt(qs?.auto.value)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-[#6b6f78]">
                    {fmt(qs?.dc.value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3.5 py-[11px] text-[11px] text-[#6b6f78]">
        {hasEpa
          ? "Ranked by season EPA (Expected Points Added). OPR shown alongside."
          : "Ranked by season Total OPR."}
      </p>
    </div>
  );
}
