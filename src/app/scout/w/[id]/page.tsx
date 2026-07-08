"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Collapsible from "@/components/Collapsible";
import { formatClock } from "@/lib/format";

const CARD = "rounded-2xl border border-[#1a1a1a] bg-surface p-5";

type SchedMatch = {
  matchNumber: number;
  red: number[];
  blue: number[];
  predictedTime: number | null;
  actualStartTime?: number | null;
};

function AllianceCell({ teams, side, align, highlight }: { teams: number[]; side: "red" | "blue"; align: "left" | "right"; highlight?: number }) {
  const color = side === "red" ? "#ff5d6c" : "#4d8dff";
  return (
    <div className={`flex flex-col gap-0.5 ${align === "right" ? "items-end text-right" : "items-start text-left"}`}>
      {teams.map((t) => (
        <span key={t} className="font-mono text-[13px]" style={{ color, fontWeight: t === highlight ? 800 : 400 }}>
          {t}
        </span>
      ))}
    </div>
  );
}

function ScheduleRows({ matches, highlight }: { matches: SchedMatch[]; highlight?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      {matches.map((m) => {
        const played = m.actualStartTime != null;
        const time = m.actualStartTime ?? m.predictedTime;
        return (
          <div
            key={m.matchNumber}
            className={`grid grid-cols-[48px_1fr] items-center gap-2.5 border-t border-[#141414] px-4 py-[11px] first:border-t-0 ${
              highlight && [...m.red, ...m.blue].includes(highlight) ? "bg-accent/[0.05]" : ""
            }`}
          >
            <span className="font-mono text-[12px] text-[#6b6f78]">Q{m.matchNumber}</span>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <AllianceCell teams={m.red} side="red" align="right" highlight={highlight} />
              <span className="whitespace-nowrap text-[11px] italic text-[#6b6f78]">
                {played ? formatClock(time) : time != null ? `~${formatClock(time)}` : "vs"}
              </span>
              <AllianceCell teams={m.blue} side="blue" align="left" highlight={highlight} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Overview({ id }: { id: Id<"workspaces"> }) {
  const data = useQuery(api.workspaces.get, { workspaceId: id });
  const teams = useQuery(api.teams.list, { workspaceId: id });
  const schedule = useQuery(api.match.schedule, { workspaceId: id });

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
        matchCount > 0 && (
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
        )
      )}
    </div>
  );
}

export default function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Overview id={id as Id<"workspaces">} />;
}
