import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getEvent } from "@/lib/ftc/queries";
import { seasonFull } from "@/lib/season";
import { eventTypeLabel } from "@/lib/ftc/labels";
import { getRankingMap } from "@/lib/rankings";
import { formatDate, locationStr } from "@/lib/format";
import EventRankings from "@/components/EventRankings";
import MatchList from "@/components/MatchList";

interface Props {
  params: Promise<{ season: string; code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season, code } = await params;
  try {
    const ev = await getEvent(Number(season), code);
    if (ev) return { title: ev.name };
  } catch {
    /* ignore */
  }
  return { title: `Event ${code}` };
}

const HEADING = "mb-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted";
const OUTLINE_BTN =
  "rounded-[10px] border border-[#232323] px-3.5 py-2 text-[13px] text-muted no-underline transition-colors hover:border-[#3a3a3a] hover:text-foreground";

function StatusBadge({ ongoing, finished }: { ongoing: boolean; finished: boolean }) {
  if (ongoing)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-teal/15 px-[11px] py-1 text-[11px] font-semibold text-teal">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
        Live
      </span>
    );
  return (
    <span className="rounded-full bg-[#161616] px-[11px] py-1 text-[11px] font-semibold text-muted">
      {finished ? "Finished" : "Upcoming"}
    </span>
  );
}

export default async function EventPage({ params }: Props) {
  const { season: seasonStr, code } = await params;
  const season = Number(seasonStr);
  if (!Number.isInteger(season)) notFound();

  const ev = await getEvent(season, code);
  if (!ev) notFound();

  const epaMap = getRankingMap(season, ev.teams.map((t) => t.teamNumber));

  const dateRange =
    ev.start === ev.end
      ? formatDate(ev.start)
      : `${formatDate(ev.start)} – ${formatDate(ev.end)}`;

  return (
    <div className="mx-auto max-w-[1240px] space-y-7 px-5 pb-6 pt-10 sm:px-8">
      {/* Header card */}
      <div className="rounded-[20px] border border-[#1a1a1a] bg-surface px-[30px] py-7">
        <div className="flex flex-wrap items-start justify-between gap-[18px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-[7px] bg-[#161616] px-2.5 py-[3px] font-mono text-[11px] text-muted">
                {eventTypeLabel(ev.type)}
              </span>
              <StatusBadge ongoing={ev.ongoing} finished={ev.finished} />
              {ev.remote && (
                <span className="rounded-[7px] bg-[#161616] px-2.5 py-[3px] font-mono text-[11px] text-muted">
                  Remote
                </span>
              )}
            </div>
            <h1 className="mt-3.5 text-[clamp(26px,3.6vw,38px)] font-semibold tracking-[-0.01em] text-[#f7f8fa]">
              {ev.name}
            </h1>
            <p className="mt-2 text-[14px] text-muted">
              {seasonFull(season)} · {dateRange} · {locationStr(ev.location)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2.5">
            {ev.website && (
              <a href={ev.website} target="_blank" rel="noreferrer" className={OUTLINE_BTN}>
                Website ↗
              </a>
            )}
            <a
              href={`https://ftcscout.org/events/${season}/${ev.code}`}
              target="_blank"
              rel="noreferrer"
              className={OUTLINE_BTN}
            >
              FTCScout ↗
            </a>
          </div>
        </div>
        <div className="mt-5 flex gap-7 text-[14px]">
          <div>
            <span className="text-[#6b6f78]">Teams</span>{" "}
            <span className="font-mono font-semibold">{ev.teams.length}</span>
          </div>
          <div>
            <span className="text-[#6b6f78]">Matches</span>{" "}
            <span className="font-mono font-semibold">
              {ev.matches.filter((m) => m.teams.length > 0).length}
            </span>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section>
          <h2 className={HEADING}>Rankings</h2>
          {ev.teams.length > 0 ? (
            <EventRankings teams={ev.teams} season={season} epa={epaMap} />
          ) : (
            <div className="card p-6 text-center text-sm text-muted">
              No team list available.
            </div>
          )}
        </section>

        <section>
          <h2 className={HEADING}>Matches</h2>
          <MatchList matches={ev.matches} season={season} />
        </section>
      </div>
    </div>
  );
}
