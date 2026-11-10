import Link from "next/link";
import type { Match, TeamEventLite } from "@/lib/ftc/types";
import type { WinLossRecord } from "@/lib/ftc/queries";
import type { EventTeamStat } from "@/lib/eventStats";
import { eventTypeLabel } from "@/lib/ftc/labels";
import { fmt, formatDate, locationStr } from "@/lib/format";
import Collapsible from "./Collapsible";
import MatchList from "./MatchList";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#6b6f78]">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums text-[#e7eaf0]">{value}</span>
    </div>
  );
}

/** One event on a team page: how the team did there, and its matches. */
export default function TeamEventCard({
  season,
  teamNumber,
  event,
  matches,
  predictions,
  rank,
  stat,
  record,
  defaultOpen,
}: {
  season: number;
  teamNumber: number;
  event: TeamEventLite["event"];
  matches: Match[]; // this team's
  predictions?: Map<string, number>;
  rank: { rank: number; rankingScore: number | null } | null;
  stat: EventTeamStat | null;
  record: WinLossRecord;
  defaultOpen: boolean;
}) {
  const games = record.wins + record.losses + record.ties;
  const hasStats = rank !== null || games > 0 || stat !== null;
  // FIRST's table at a League Meet is the league's running one, not this meet's.
  const standing = event.type === "LeagueMeet" ? "League " : "";
  return (
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      <Link
        prefetch={false}
        href={`/events/${season}/${event.code}`}
        className="flex items-center justify-between gap-4 px-5 py-[15px] no-underline transition-colors hover:bg-[#101010]"
      >
        <div className="min-w-0">
          <div className="truncate font-medium text-[#e7eaf0]">{event.name}</div>
          <div className="truncate text-[12px] text-[#6b6f78]">{locationStr(event.location)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3.5">
          {event.ongoing && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal/15 px-[9px] py-[3px] text-[11px] font-semibold text-teal">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
              Live
            </span>
          )}
          <span className="hidden rounded-[7px] bg-[#161616] px-[9px] py-[3px] font-mono text-[11px] text-muted sm:block">
            {eventTypeLabel(event.type)}
          </span>
          <span className="hidden text-[12px] text-[#6b6f78] sm:block">{formatDate(event.start)}</span>
          <span className="text-[#6b6f78]">→</span>
        </div>
      </Link>

      {hasStats && (
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 border-t border-[#141414] px-5 py-3">
          {rank && <Stat label={`${standing}rank`} value={`#${rank.rank}`} />}
          {rank?.rankingScore != null && <Stat label={`${standing}RS`} value={fmt(rank.rankingScore, 2)} />}
          {games > 0 && (
            <Stat
              label={record.ties > 0 ? "W-L-T" : "W-L"}
              value={`${record.wins}–${record.losses}${record.ties > 0 ? `–${record.ties}` : ""}`}
            />
          )}
          {stat?.oprNp != null && <Stat label="NP OPR" value={fmt(stat.oprNp)} />}
          {stat && <Stat label="EPA after" value={fmt(stat.epa)} />}
        </div>
      )}

      {matches.length > 0 && (
        <div className="border-t border-[#141414] px-5 py-3">
          <Collapsible
            defaultOpen={defaultOpen}
            gap="mb-2.5"
            header={
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">
                Matches <span className="text-[#3a3f48]">({matches.length})</span>
              </span>
            }
          >
            <MatchList
              matches={matches}
              season={season}
              predictions={predictions}
              timezone={event.timezone}
              focusTeam={teamNumber}
            />
          </Collapsible>
        </div>
      )}
    </div>
  );
}
