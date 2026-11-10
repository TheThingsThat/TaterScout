"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TeamSummary } from "@/lib/teamSummary";
import { fmt } from "@/lib/format";
import { seasonFull } from "@/lib/season";
import StarButton from "./StarButton";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const COLS = "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_auto]";

/** "in 3d 4h", "in 5h 12m", "in 12m": time left until `ms`. */
function countdown(ms: number, now: number): string {
  const d = Math.max(0, ms - now);
  if (d >= DAY) return `in ${Math.floor(d / DAY)}d ${Math.floor((d % DAY) / HOUR)}h`;
  if (d >= HOUR) return `in ${Math.floor(d / HOUR)}h ${Math.floor((d % HOUR) / MIN)}m`;
  return `in ${Math.max(1, Math.ceil(d / MIN))}m`;
}

/** Event dates are venue calendar days, so show them as such (not shifted into the viewer's zone). */
function venueDate(ms: number | null, tzFree: string | null): string {
  if (!tzFree) return ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  return new Date(`${tzFree}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The current time, ticking every 30 seconds (countdowns, live badges). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** At the event right now, by the clock (the server's `ongoing` is a snapshot). */
export function isLive(e: NonNullable<TeamSummary["next"]>, now: number): boolean {
  return e.startMs !== null && e.startMs <= now && (e.endMs === null || now < e.endMs);
}

/** The shown event has finished, so the row should be fetched again for the next one. */
export function hasEnded(t: TeamSummary, now: number): boolean {
  return t.next?.endMs != null && t.next.endMs <= now;
}

function NextEvent({ t, now, season }: { t: TeamSummary; now: number; season: number }) {
  const e = t.next;
  if (!e) return <span className="text-[13px] text-[#6b6f78]">No upcoming events</span>;
  const live = isLive(e, now);
  // Over but not yet refetched (or the refetch failed): no "Starts in 1m" countdown.
  const ended = e.endMs !== null && now >= e.endMs;
  const place = [e.city, e.state].filter(Boolean).join(", ");
  return (
    <div className="min-w-0">
      <Link
        prefetch={false}
        href={`/events/${season}/${e.code}`}
        className="block truncate text-[14px] text-[#e7eaf0] no-underline hover:text-foreground hover:underline"
        title={e.name}
      >
        {e.name}
      </Link>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[#8a90a0]">
        <span>
          {venueDate(e.startMs, e.start)}
          {e.end && e.end !== e.start ? ` – ${venueDate(e.endMs, e.end)}` : ""}
          {place ? ` · ${place}` : ""}
        </span>
        {live ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Live now
          </span>
        ) : !ended && e.startMs !== null ? (
          <span className="rounded-full bg-[#141414] px-2 py-0.5 font-mono text-[11px] text-[#cfd3da]">
            Starts {countdown(e.startMs, now)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, rank, wide }: { label: string; value: string; rank?: number | null; wide?: boolean }) {
  return (
    <div className={`${wide ? "w-[96px]" : "w-[76px]"} text-left md:text-right`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6b6f78]">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#f7f8fa]">{value}</div>
      {rank != null && <div className="text-[11px] tabular-nums text-[#6b6f78]">#{rank.toLocaleString()}</div>}
    </div>
  );
}

/**
 * The homepage's team list: star toggle, team, next event with a countdown, and world
 * rank / EPA / OPR. `footer` renders under the last row (loading or retry notes).
 */
export default function TeamTable({
  rows,
  now,
  season,
  teamCount,
  footer,
}: {
  rows: TeamSummary[];
  now: number;
  season: number | null;
  teamCount: number | null;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-[#1a1a1a] bg-surface">
      <div
        className={`hidden ${COLS} gap-6 border-b border-[#141414] px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#6b6f78] md:grid`}
      >
        <span>Team</span>
        <span>Next event</span>
        <span className="text-right">
          {season ? seasonFull(season) : ""}
          {teamCount ? ` · ${teamCount.toLocaleString()} teams` : ""}
        </span>
      </div>
      {rows.map((t) => (
        <div
          key={t.number}
          className={`grid gap-3 border-t border-[#141414] px-5 py-4 first:border-t-0 ${COLS} md:items-center md:gap-6`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <StarButton team={t.number} compact />
            <Link prefetch={false} href={`/teams/${t.number}`} className="min-w-0 no-underline">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[14px] font-bold text-accent">{t.number}</span>
                <span className="truncate text-[15px] font-medium text-[#f7f8fa] hover:underline">{t.name}</span>
              </div>
              {t.region && <div className="mt-0.5 truncate text-[12px] text-[#6b6f78]">{t.region}</div>}
            </Link>
          </div>
          <NextEvent t={t} now={now} season={season ?? 0} />
          <div className="flex flex-wrap justify-start gap-x-3 gap-y-2 md:flex-nowrap md:justify-end">
            <Stat label="World rank" value={t.rkEpa != null ? `#${t.rkEpa.toLocaleString()}` : "—"} />
            <Stat label="EPA" value={fmt(t.epa)} />
            <Stat label="OPR" value={fmt(t.oprNp)} rank={t.rkOprNp} />
            {/* Always rendered so every row's columns line up, rated or not. */}
            <Stat
              label="Tips A / T"
              value={t.tipsAuto != null || t.tipsTele != null ? `${fmt(t.tipsAuto, 2)} / ${fmt(t.tipsTele, 2)}` : "—"}
              wide
            />
          </div>
        </div>
      ))}
      {footer && (
        <div className="border-t border-[#141414] px-5 py-4 text-[13px] text-[#6b6f78] first:border-t-0">{footer}</div>
      )}
    </div>
  );
}
