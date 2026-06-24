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

function StatusBadge({
  ongoing,
  finished,
}: {
  ongoing: boolean;
  finished: boolean;
}) {
  if (ongoing)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-2/15 px-2.5 py-0.5 text-xs font-medium text-accent-2">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-2" />
        Live
      </span>
    );
  return (
    <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">
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

  const epaMap = getRankingMap(
    season,
    ev.teams.map((t) => t.teamNumber),
  );

  const dateRange =
    ev.start === ev.end
      ? formatDate(ev.start)
      : `${formatDate(ev.start)} – ${formatDate(ev.end)}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                {eventTypeLabel(ev.type)}
              </span>
              <StatusBadge ongoing={ev.ongoing} finished={ev.finished} />
              {ev.remote && (
                <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                  Remote
                </span>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{ev.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {seasonFull(season)} · {dateRange} · {locationStr(ev.location)}
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            {ev.website && (
              <a
                href={ev.website}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-foreground"
              >
                Website ↗
              </a>
            )}
            <a
              href={`https://ftcscout.org/events/${season}/${ev.code}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-foreground"
            >
              FTCScout ↗
            </a>
          </div>
        </div>
        <div className="mt-4 flex gap-6 text-sm">
          <div>
            <span className="text-muted">Teams</span>{" "}
            <span className="font-semibold">{ev.teams.length}</span>
          </div>
          <div>
            <span className="text-muted">Matches</span>{" "}
            <span className="font-semibold">
              {ev.matches.filter((m) => m.teams.length > 0).length}
            </span>
          </div>
        </div>
      </div>

      {/* Rankings + Matches */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Rankings
          </h2>
          {ev.teams.length > 0 ? (
            <EventRankings teams={ev.teams} season={season} epa={epaMap} />
          ) : (
            <div className="card p-6 text-center text-sm text-muted">
              No team list available.
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Matches
          </h2>
          <MatchList matches={ev.matches} season={season} />
        </section>
      </div>
    </div>
  );
}
