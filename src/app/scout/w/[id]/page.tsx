"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Collapsible from "@/components/Collapsible";
import { formatClock, fmt } from "@/lib/format";

const CARD = "rounded-2xl border border-[#1a1a1a] bg-surface p-5";
const HEADING = "mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[#6b6f78]";

type SchedMatch = {
  matchNumber: number;
  red: number[];
  blue: number[];
  predictedTime: number | null;
  actualStartTime?: number | null;
  redScore?: number | null;
  blueScore?: number | null;
};
type TeamRow = {
  teamNumber: number;
  name: string;
  rank: number | null;
  epa: number | null;
  oprNp: number | null;
};

// Match `lg:` breakpoint (1024px) in JS so the schedule can render expanded on
// desktop and as a dropdown on mobile without duplicating the markup.
function useIsDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

function AllianceCell({ teams, side, won, align }: { teams: number[]; side: "red" | "blue"; won: boolean; align: "left" | "right" }) {
  const color = won ? (side === "red" ? "#ff5d6c" : "#4d8dff") : "#6b6f78";
  return (
    <div className={`flex flex-col gap-0.5 ${align === "right" ? "items-end text-right" : "items-start text-left"}`}>
      {teams.map((t) => (
        <span key={t} className="font-mono text-[13px]" style={{ color, fontWeight: won ? 700 : 400 }}>
          {t}
        </span>
      ))}
    </div>
  );
}

// Duplicates the event page's qualification rows: final scores (winner
// emphasized) for played matches, our predicted start time for upcoming ones.
function ScheduleRows({ matches, highlight }: { matches: SchedMatch[]; highlight?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      {matches.map((m) => {
        const redScore = m.redScore ?? null;
        const blueScore = m.blueScore ?? null;
        const played = redScore != null && blueScore != null;
        const redWon = played && redScore > blueScore;
        const blueWon = played && blueScore > redScore;
        const time = m.actualStartTime ?? m.predictedTime;
        const mine = highlight != null && [...m.red, ...m.blue].includes(highlight);
        return (
          <div
            key={m.matchNumber}
            className={`grid grid-cols-[48px_1fr] items-center gap-2.5 border-t border-[#141414] px-4 py-[11px] first:border-t-0 ${mine ? "bg-accent/[0.05]" : ""}`}
          >
            <span className="font-mono text-[12px] text-[#6b6f78]">Q{m.matchNumber}</span>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <AllianceCell teams={m.red} side="red" won={redWon} align="right" />
              {played ? (
                <div className="flex items-center justify-center gap-1.5 font-mono text-[14px] tabular-nums">
                  <span style={{ color: redWon ? "#ff5d6c" : "#6b6f78", fontWeight: redWon ? 700 : 400 }}>{redScore}</span>
                  <span className="text-[#3a3f48]">–</span>
                  <span style={{ color: blueWon ? "#4d8dff" : "#6b6f78", fontWeight: blueWon ? 700 : 400 }}>{blueScore}</span>
                </div>
              ) : (
                <span className="whitespace-nowrap text-[11px] italic text-[#6b6f78]">
                  {time != null ? `~${formatClock(time)}` : "vs"}
                </span>
              )}
              <AllianceCell teams={m.blue} side="blue" won={blueWon} align="left" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TH = "px-2.5 py-2.5 text-right font-mono text-[10px] font-bold uppercase tracking-[0.1em]";

// Team rankings, duplicated from the event-page rankings: sort by EPA or by the
// actual qualification standing.
function RankingsTable({ teams, season, highlight }: { teams: TeamRow[]; season: number; highlight?: number }) {
  const hasEpa = teams.some((t) => t.epa != null);
  const hasRank = teams.some((t) => t.rank != null);
  const [sort, setSort] = useState<"epa" | "rank">(hasEpa ? "epa" : "rank");

  const ranked = [...teams].sort((a, b) => {
    if (sort === "rank") {
      return (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.teamNumber - b.teamNumber;
    }
    return (b.epa ?? -Infinity) - (a.epa ?? -Infinity) || (b.oprNp ?? -Infinity) - (a.oprNp ?? -Infinity);
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      {(hasEpa || hasRank) && (
        <div className="flex items-center justify-end gap-1.5 border-b border-[#1f1f1f] px-3 py-2">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#6b6f78]">Sort</span>
          <div className="flex rounded-lg border border-[#232323] p-0.5 text-[12px]">
            {hasEpa && (
              <button onClick={() => setSort("epa")} className={`rounded-md px-2.5 py-1 ${sort === "epa" ? "bg-[#1c1c1c] text-foreground" : "text-muted"}`}>
                EPA
              </button>
            )}
            <button onClick={() => setSort("rank")} className={`rounded-md px-2.5 py-1 ${sort === "rank" ? "bg-[#1c1c1c] text-foreground" : "text-muted"}`}>
              Qual rank
            </button>
          </div>
        </div>
      )}
      <div className="ts-scroll overflow-x-auto">
        <table className="w-full min-w-[20rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#1f1f1f] text-[#6b6f78]">
              <th className="px-3 py-2.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em]">#</th>
              <th className="px-3 py-2.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em]">Team</th>
              {hasEpa && <th className={TH} style={{ color: "#2f8bff" }}>EPA</th>}
              <th className={TH} style={{ color: "#3ecf76" }}>OPR</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t, i) => (
              <tr
                key={t.teamNumber}
                className={`border-b border-[#141414] last:border-0 hover:bg-[#101010] ${t.teamNumber === highlight ? "bg-accent/[0.05]" : ""}`}
              >
                <td className="px-3 py-2.5 font-mono text-[#6b6f78]">{sort === "rank" ? (t.rank ?? i + 1) : i + 1}</td>
                <td className="px-3 py-2.5">
                  <Link href={`/teams/${t.teamNumber}?season=${season}`} className="no-underline hover:text-accent">
                    <span className="font-mono text-[#6b6f78]">{t.teamNumber}</span>{" "}
                    <span className="font-medium text-[#e7eaf0]">{t.name}</span>
                  </Link>
                </td>
                {hasEpa && (
                  <td className="px-2.5 py-2.5 text-right font-semibold tabular-nums" style={{ color: "#2f8bff" }}>{fmt(t.epa)}</td>
                )}
                <td className="px-2.5 py-2.5 text-right tabular-nums" style={{ color: "#3ecf76" }}>{fmt(t.oprNp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Overview({ id }: { id: Id<"workspaces"> }) {
  const data = useQuery(api.workspaces.get, { workspaceId: id });
  const teams = useQuery(api.teams.list, { workspaceId: id });
  const schedule = useQuery(api.match.schedule, { workspaceId: id });
  const isDesktop = useIsDesktop();

  if (data === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (data === null)
    return (
      <div className={`${CARD} text-center text-sm text-muted`}>
        No access. <Link href="/scout" className="text-accent no-underline">Back</Link>
      </div>
    );

  const { workspace, member } = data;
  const teamCount = teams?.length ?? 0;
  const matches = (schedule ?? []) as SchedMatch[];
  const matchCount = matches.length;
  const myTeam = workspace.myTeam ?? null;

  // Next unplayed match for our team (Up next).
  const nextMatch =
    myTeam != null
      ? matches
          .filter((m) => m.actualStartTime == null && [...m.red, ...m.blue].includes(myTeam))
          .sort((a, b) => a.matchNumber - b.matchNumber)[0] ?? null
      : null;

  const scheduleBlock =
    matchCount > 0 &&
    (isDesktop ? (
      <div>
        <div className={HEADING}>
          Qualification schedule <span className="text-[#3a3f48]">({matchCount})</span>
        </div>
        <ScheduleRows matches={matches} highlight={myTeam ?? undefined} />
      </div>
    ) : (
      <Collapsible
        defaultOpen={false}
        gap="mb-2"
        header={
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">
            Qualification schedule <span className="text-[#3a3f48]">({matchCount})</span>
          </span>
        }
      >
        <ScheduleRows matches={matches} highlight={myTeam ?? undefined} />
      </Collapsible>
    ));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-0.01em]">{workspace.name}</h1>
        <p className="mt-1 text-[14px] text-muted">
          {workspace.eventName || workspace.eventCode || "No event yet"} · you are{" "}
          <span className="text-foreground">{member.name}</span> ({member.role})
        </p>
        {member.role === "admin" && (
          <p className="mt-1 text-[13px] text-muted">
            Join code{" "}
            <span className="font-mono font-semibold tracking-[0.14em] text-foreground">
              {workspace.joinCode}
            </span>
          </p>
        )}
      </div>

      {/* Up next for our team */}
      {myTeam != null && nextMatch && (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-accent/40 bg-accent/[0.06] px-5 py-3.5">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Up next · {myTeam}
          </span>
          <span className="font-mono text-[15px] font-bold">Q{nextMatch.matchNumber}</span>
          <span className="text-[14px] text-muted">
            {nextMatch.predictedTime != null ? `~${formatClock(nextMatch.predictedTime)}` : "time TBD"}
          </span>
        </div>
      )}
      {myTeam != null && !nextMatch && matchCount > 0 && (
        <div className="rounded-[14px] border border-[#1f1f1f] bg-surface px-5 py-3 text-[13px] text-muted">
          No upcoming matches for team <span className="font-mono text-foreground">{myTeam}</span>.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className={CARD}>
          <div className="text-[28px] font-bold tabular-nums">{teamCount}</div>
          <div className="text-[12px] text-muted">teams</div>
        </div>
        <div className={CARD}>
          <div className="text-[28px] font-bold tabular-nums">{matchCount}</div>
          <div className="text-[12px] text-muted">qual matches</div>
        </div>
      </div>

      {teamCount === 0 ? (
        <div className={`${CARD} text-[14px] text-muted`}>
          {member.role === "admin" ? (
            <>
              No event imported yet.{" "}
              <Link href={`/scout/w/${id}/setup`} className="text-accent no-underline">
                Go to Setup →
              </Link>
            </>
          ) : (
            "Waiting for an admin to import the event."
          )}
        </div>
      ) : (
        // Desktop: rankings (left) + schedule (right). Mobile: stacked, schedule collapses.
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className={HEADING}>Team rankings</div>
            <RankingsTable teams={(teams ?? []) as TeamRow[]} season={workspace.season} highlight={myTeam ?? undefined} />
          </div>
          {matchCount > 0 && <div>{scheduleBlock}</div>}
        </div>
      )}
    </div>
  );
}

export default function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Overview id={id as Id<"workspaces">} />;
}
