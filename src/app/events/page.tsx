import Link from "next/link";
import Form from "next/form";
import type { Metadata } from "next";
import { getEventIndex } from "@/lib/ftc/queries";
import type { EventIndexRow } from "@/lib/ftc/types";
import { eventTypeLabel, NON_COMPETITION_TYPES } from "@/lib/ftc/labels";
import { CURRENT_SEASON, parseSeasonParam, pastSeasons, seasonLabel, seasonName } from "@/lib/season";
import { formatDate, locationStr } from "@/lib/format";
import { scheduleAutoRefresh } from "@/lib/data/autoRefresh";

export const metadata: Metadata = {
  title: "Events",
  description: "Every FTC event this season: today's events, upcoming and finished, filterable by region and type.",
};

const PAGE_SIZE = 50;
const ALL_TYPES = "all"; // type filter value that also shows kickoffs, workshops and the like
const STATUSES = ["today", "upcoming", "finished"] as const;
const STATUS_LABEL: Record<EventIndexRow["status"], string> = {
  today: "Today",
  upcoming: "Upcoming",
  finished: "Finished",
};

const HEADING = "mb-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted";
const FIELD =
  "rounded-full border border-[#232323] bg-[#0c0c0c] px-4 py-[9px] text-[14px] text-foreground outline-none focus:border-accent";

type Param = string | string[] | undefined; // repeated in the URL, it arrives as an array

interface Props {
  searchParams: Promise<Record<"season" | "q" | "type" | "region" | "status" | "page", Param>>;
}

const one = (p: Param): string => (typeof p === "string" ? p : "");

function dateRange(e: EventIndexRow): string {
  return e.start === e.end ? formatDate(e.start) : `${formatDate(e.start, { year: false })} – ${formatDate(e.end)}`;
}

function EventRow({ e, showStatus }: { e: EventIndexRow; showStatus: boolean }) {
  // No prefetch on team/event links site-wide: every link scrolled into view would
  // spend the proxy's per-IP budget (a whole venue shares one), and a click still
  // gets its loading state as soon as the server streams it.
  return (
    <Link
      prefetch={false}
      href={`/events/${e.season}/${e.code}`}
      className="flex items-center justify-between gap-4 border-t border-[#141414] px-5 py-[13px] no-underline transition-colors first:border-t-0 hover:bg-[#101010]"
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-[#e7eaf0]">{e.name}</div>
        <div className="truncate text-[12px] text-[#6b6f78]">{locationStr(e.location)}</div>
        <div className="text-[12px] text-[#6b6f78] sm:hidden">{dateRange(e)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3.5">
        {showStatus && e.status === "today" && (
          <span className="rounded-full bg-teal/15 px-[9px] py-[3px] text-[11px] font-semibold text-teal">Today</span>
        )}
        <span className="hidden rounded-[7px] bg-[#161616] px-[9px] py-[3px] font-mono text-[11px] text-muted sm:block">
          {eventTypeLabel(e.type)}
        </span>
        <span className="hidden text-[12px] text-[#6b6f78] sm:block">{dateRange(e)}</span>
      </div>
    </Link>
  );
}

export default async function EventsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const season = parseSeasonParam(one(sp.season));
  const rawQ = one(sp.q);
  const q = rawQ.trim().toLowerCase().slice(0, 100);
  const status = STATUSES.find((s) => s === sp.status) ?? "";

  scheduleAutoRefresh(season); // post-response staleness check (never blocks)

  const events = await getEventIndex(season);
  const competition = events.filter((e) => !NON_COMPETITION_TYPES.has(e.type));
  const byName = (a: EventIndexRow, b: EventIndexRow) => a.name.localeCompare(b.name);
  const today = competition.filter((e) => e.status === "today").sort(byName);

  // Filter choices come from the season's own data, so a new FIRST type or region shows
  // up by itself. A value from the URL that isn't a choice is ignored, as the dropdown
  // can't show it, and regions are those the chosen type can actually return.
  const types = [...new Set(events.map((e) => e.type))].sort((a, b) =>
    eventTypeLabel(a).localeCompare(eventTypeLabel(b)),
  );
  const rawType = one(sp.type);
  const type = rawType === ALL_TYPES || types.includes(rawType) ? rawType : "";
  const searched = type === ALL_TYPES || NON_COMPETITION_TYPES.has(type) ? events : competition;
  const regions = [...new Set(searched.flatMap((e) => (e.regionCode ? [e.regionCode] : [])))].sort();
  const rawRegion = one(sp.region);
  const region = regions.includes(rawRegion) ? rawRegion : "";
  const filtered = !!(q || type || region || status);

  const matches = searched.filter(
    (e) =>
      (!type || type === ALL_TYPES || e.type === type) &&
      (!region || e.regionCode === region) &&
      (!status || e.status === status) &&
      // Today's events have their own section until a filter is in play.
      (filtered || e.status !== "today") &&
      (!q ||
        [e.name, e.code, e.location.city, e.location.state, e.location.country].some((s) =>
          s?.toLowerCase().includes(q),
        )),
  );
  // Soonest upcoming first, then most recently finished.
  const rank = { today: 0, upcoming: 1, finished: 2 };
  matches.sort((a, b) => {
    if (a.status !== b.status) return rank[a.status] - rank[b.status];
    const byDate = a.status === "finished" ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start);
    return byDate || byName(a, b);
  });

  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(one(sp.page))) || 1));
  const rows = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const href = (over: { season?: number; page?: number }) => {
    const p = new URLSearchParams();
    const s = over.season ?? season;
    if (s !== CURRENT_SEASON) p.set("season", String(s));
    // Changing season starts over: types and regions differ between seasons.
    if (over.season == null) {
      if (q) p.set("q", rawQ);
      if (type) p.set("type", type);
      if (region) p.set("region", region);
      if (status) p.set("status", status);
      if ((over.page ?? 1) > 1) p.set("page", String(over.page));
    }
    const qs = p.toString();
    return qs ? `/events?${qs}` : "/events";
  };

  const pagerBtn = (disabled: boolean) =>
    `rounded-md border border-[#1a1a1a] px-2 py-1 ${disabled ? "pointer-events-none opacity-40" : "hover:text-foreground"}`;

  return (
    <div className="mx-auto max-w-[1240px] space-y-7 px-5 pb-6 pt-10 sm:px-8">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6b6f78]">
          {seasonName(season)} · {seasonLabel(season)}
        </div>
        <h1 className="mt-2.5 text-[clamp(32px,4vw,46px)] font-semibold tracking-[-0.01em] text-[#f7f8fa]">
          Events
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[CURRENT_SEASON, ...pastSeasons().sort((a, b) => b - a)].map((s) => (
            <Link
              key={s}
              href={href({ season: s })}
              className="rounded-[10px] px-3 py-1.5 text-[13px] transition-colors"
              style={
                s === season
                  ? { background: "var(--accent)", border: "1px solid var(--accent)", color: "#fff", fontWeight: 500 }
                  : { border: "1px solid #232323", color: "#9aa0aa" }
              }
            >
              {seasonLabel(s)}
            </Link>
          ))}
        </div>
      </div>

      {!filtered && today.length > 0 && (
        <section>
          <h2 className={HEADING}>
            Today&apos;s events <span className="text-[#3a3f48]">({today.length})</span>
          </h2>
          <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
            {today.map((e) => (
              <EventRow key={e.code} e={e} showStatus={false} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className={HEADING}>
          {filtered ? "Matching events" : "All events"}{" "}
          <span className="text-[#3a3f48]">({matches.length.toLocaleString()})</span>
        </h2>
        {/* Keyed so Clear, Back and a season switch reset the uncontrolled fields. */}
        <Form
          key={`${season}|${rawQ}|${type}|${region}|${status}`}
          action="/events"
          className="mb-3.5 flex flex-wrap items-center gap-2.5"
        >
          {season !== CURRENT_SEASON && <input type="hidden" name="season" value={season} />}
          <input
            name="q"
            defaultValue={rawQ}
            placeholder="Name, code or place"
            aria-label="Search events"
            className={`${FIELD} min-w-[200px] flex-1 placeholder:text-[#6b6f78]`}
          />
          <select name="status" defaultValue={status} aria-label="Filter by status" className={FIELD}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select name="type" defaultValue={type} aria-label="Filter by event type" className={FIELD}>
            <option value="">Competitions</option>
            <option value={ALL_TYPES}>Everything</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {eventTypeLabel(t)}
              </option>
            ))}
          </select>
          <select name="region" defaultValue={region} aria-label="Filter by region" className={FIELD}>
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-full border border-accent/40 bg-accent/[0.08] px-4 py-[9px] text-[14px] text-accent transition-colors hover:bg-accent/[0.14]"
          >
            Filter
          </button>
          {filtered && (
            <Link href={href({ season })} className="text-[13px] text-muted no-underline hover:text-foreground">
              Clear
            </Link>
          )}
        </Form>

        {rows.length === 0 ? (
          <div className="card p-6 text-center text-sm text-muted">
            {events.length === 0 ? "FIRST's event list isn't available right now." : "No events match."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
            {rows.map((e) => (
              <EventRow key={e.code} e={e} showStatus />
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="mt-3 flex items-center justify-end gap-3 text-[12px] text-[#6b6f78]">
            <span className="font-mono">
              Page {page} / {pages}
            </span>
            <Link href={href({ page: page - 1 })} className={pagerBtn(page <= 1)}>
              ← Prev
            </Link>
            <Link href={href({ page: page + 1 })} className={pagerBtn(page >= pages)}>
              Next →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
