"use client";

import { useState } from "react";
import Link from "next/link";
import type { EventTeam } from "@/lib/ftc/types";
import type { TeamRanking } from "@/lib/rankings";
import type { EventTeamStat } from "@/lib/eventStats";
import { fmt } from "@/lib/format";

const TH = "px-2.5 py-3 text-right font-mono text-[10px] font-bold uppercase tracking-[0.1em]";
type SortMode = "epa" | "rank";

export default function EventRankings({
  teams,
  season,
  stats,
  epa,
}: {
  teams: EventTeam[];
  season: number;
  // Post-event (as-of-end-of-event) ratings, keyed by team number.
  stats: Map<number, EventTeamStat>;
  // Season ratings — fallback when a team/event isn't in the snapshot.
  epa: Map<number, TeamRanking>;
}) {
  const hasEpa = stats.size > 0 || epa.size > 0;
  const hasRank = teams.some((t) => t.stats?.rank != null);
  const [sort, setSort] = useState<SortMode>(hasEpa ? "epa" : "rank");

  // EPA → post-event snapshot, season EPA as fallback.
  // OPR → the time-aware per-event snapshot, season OPR as a deeper fallback.
  const rowOf = (t: EventTeam) => {
    const s = stats.get(t.teamNumber);
    const qs = t.team.quickStats;
    const evOpr = t.stats?.opr;
    return {
      epa: s?.epa ?? epa.get(t.teamNumber)?.epa ?? null,
      oprNp: evOpr?.totalPointsNp ?? s?.oprNp ?? qs?.tot.value ?? null,
    };
  };

  const ranked = [...teams].sort((a, b) => {
    if (sort === "rank") {
      const ar = a.stats?.rank ?? Infinity;
      const br = b.stats?.rank ?? Infinity;
      if (ar !== br) return ar - br;
      return a.teamNumber - b.teamNumber;
    }
    const ae = rowOf(a).epa ?? -Infinity;
    const be = rowOf(b).epa ?? -Infinity;
    if (ae !== be) return be - ae;
    return (rowOf(b).oprNp ?? -Infinity) - (rowOf(a).oprNp ?? -Infinity);
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      {(hasEpa || hasRank) && (
        <div className="flex items-center justify-end gap-1.5 border-b border-[#1f1f1f] px-3 py-2">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#6b6f78]">
            Sort
          </span>
          <div className="flex rounded-lg border border-[#232323] p-0.5 text-[12px]">
            {hasEpa && (
              <button
                onClick={() => setSort("epa")}
                className={`rounded-md px-2.5 py-1 ${sort === "epa" ? "bg-[#1c1c1c] text-foreground" : "text-muted"}`}
              >
                EPA
              </button>
            )}
            <button
              onClick={() => setSort("rank")}
              className={`rounded-md px-2.5 py-1 ${sort === "rank" ? "bg-[#1c1c1c] text-foreground" : "text-muted"}`}
            >
              Qual rank
            </button>
          </div>
        </div>
      )}
      <div className="ts-scroll overflow-x-auto">
        <table className="w-full min-w-[22rem] border-collapse text-[13px]">
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
            </tr>
          </thead>
          <tbody>
            {ranked.map((t, i) => {
              const row = rowOf(t);
              return (
                <tr
                  key={t.teamNumber}
                  className="border-b border-[#141414] transition-colors last:border-0 hover:bg-[#101010]"
                >
                  <td className="px-3.5 py-2.5 font-mono text-[#6b6f78]">
                    {sort === "rank" ? (t.stats?.rank ?? i + 1) : i + 1}
                  </td>
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
                      {fmt(row.epa)}
                    </td>
                  )}
                  <td className="px-2.5 py-2.5 text-right tabular-nums" style={{ color: "#3ecf76" }}>
                    {fmt(row.oprNp)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3.5 py-[11px] text-[11px] text-[#6b6f78]">
        {sort === "rank"
          ? "Ranked by qualification standing."
          : stats.size > 0
            ? "Ranked by EPA. EPA & OPR as of the end of this event (not season-final)."
            : "Ranked by season EPA. OPR shown alongside."}
      </p>
    </div>
  );
}
