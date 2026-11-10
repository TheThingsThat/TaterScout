import type { Metadata } from "next";
import { connection } from "next/server";
import { loadStatus, type Level } from "@/lib/status";
import { CURRENT_SEASON, seasonFull } from "@/lib/season";
import { formatAgo } from "@/lib/format";
import { scheduleAutoRefresh } from "@/lib/data/autoRefresh";
import LiveRefresh from "@/components/LiveRefresh";
import LocalClock from "@/components/LocalClock";

export const metadata: Metadata = {
  title: "Status",
  description: "Whether TaterScout's systems are working, and how fresh its data is.",
};

const HEADING = "mb-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted";
const DAY = 86_400_000;

const DOT: Record<Level, string> = {
  ok: "var(--opr)",
  degraded: "var(--gold)",
  down: "var(--red)",
  info: "var(--dim)",
};
const LABEL: Record<Level, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  info: "Not running here",
};
const BANNER: Record<Level, string> = {
  ok: "All systems operational",
  degraded: "Some systems are degraded",
  down: "Some systems are down",
  info: "All systems operational",
};

function Dot({ level }: { level: Level }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[level] }} />;
}

/** "12 min ago · 3:45 PM" in the viewer's zone; dates instead of clocks past a day. */
function When({ ms, now }: { ms: number | null; now: number }) {
  if (!ms) return <span className="text-dim">never</span>;
  return (
    <>
      {formatAgo(ms, now)}
      <span className="text-dim">
        {" · "}
        <LocalClock ms={ms} date={Math.abs(now - ms) >= DAY} />
      </span>
    </>
  );
}

function Row({ name, value, note }: { name: string; value: React.ReactNode; note: string }) {
  return (
    <div className="grid gap-1 border-t border-line px-5 py-3.5 first:border-t-0 sm:grid-cols-[220px_1fr] sm:gap-4">
      <div className="text-[14px] font-medium text-body">{name}</div>
      <div>
        <div className="text-[14px] tabular-nums text-body">{value}</div>
        <div className="mt-0.5 text-[12px] text-dim">{note}</div>
      </div>
    </div>
  );
}

export default async function StatusPage() {
  await connection(); // every view judges the checks against the current time
  scheduleAutoRefresh(CURRENT_SEASON); // a status visit also keeps the sync going

  const { probes, season, now, checks, level } = await loadStatus();
  const s = probes.sync;
  const first = checks.find((c) => c.name === "FIRST Events API")!;
  const ranksPending = s !== null && s.lastChangedAt > s.lastRankSyncAt;
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

  return (
    <div className="mx-auto max-w-[900px] space-y-7 px-5 pb-6 pt-10 sm:px-8">
      <LiveRefresh enabled />
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
          {seasonFull(CURRENT_SEASON)}
        </div>
        <h1 className="mt-2.5 text-[clamp(32px,4vw,46px)] font-semibold tracking-[-0.01em] text-heading">
          Status
        </h1>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border px-5 py-4"
        style={{
          borderColor: `color-mix(in srgb, ${DOT[level]} 33%, transparent)`,
          background: `color-mix(in srgb, ${DOT[level]} 7%, transparent)`,
        }}
      >
        <div className="flex items-center gap-3">
          <Dot level={level} />
          <span className="text-[17px] font-semibold text-heading">{BANNER[level]}</span>
        </div>
        <span className="text-[12px] text-muted">
          Checked {formatAgo(probes.checkedAt, now)} · rechecked every 2 minutes
        </span>
      </div>

      <section>
        <h2 className={HEADING}>Systems</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {checks.map((c) => (
            <div
              key={c.name}
              className="flex items-start justify-between gap-4 border-t border-line px-5 py-3.5 first:border-t-0"
            >
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-body">{c.name}</div>
                <div className="mt-0.5 text-[12px] text-muted">{c.summary}</div>
              </div>
              <span className="flex shrink-0 items-center gap-2 text-[12px]" style={{ color: DOT[c.level] }}>
                <Dot level={c.level} />
                {LABEL[c.level]}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className={HEADING}>Data freshness</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <Row
            name="Live scores & schedules"
            value={first.level === "down" ? "Unavailable" : "Live from FIRST"}
            note={
              first.level === "down"
                ? first.summary
                : "Event and team pages fetch FIRST on each view, cached for up to a minute."
            }
          />
          <Row
            name="EPA, OPR & trajectories"
            value={
              <>
                New match data <When ms={s?.lastChangedAt ?? null} now={now} />
              </>
            }
            note={`Checked for new results ${s?.lastSyncAt ? formatAgo(s.lastSyncAt, now) : "never"}. During events this runs every 5–15 minutes, and hourly when nothing is happening. Team pages can lag a further 5 minutes, and leaderboards 10.`}
          />
          <Row
            name="Leaderboard positions"
            value={
              <>
                Reconciled <When ms={s?.lastRankSyncAt ?? null} now={now} />
              </>
            }
            note={
              ranksPending
                ? "Ratings have changed since then; positions catch up within a day. Rating values themselves are current."
                : "Up to date with the latest ratings."
            }
          />
          <Row
            name="Season totals"
            value={
              season ? (
                <>
                  {season.teamCount.toLocaleString()} teams · {season.matchCount.toLocaleString()} matches
                </>
              ) : (
                "—"
              )
            }
            note={
              season
                ? `Computed ${formatAgo(Date.parse(season.computedAt), now)}; shown as of the last change to the totals.`
                : "Not available."
            }
          />
        </div>
      </section>

      <p className="text-[12px] text-dim">
        Data syncs while people use the site, so a quiet stretch with no visitors means no sync until the next
        page view; this page counts as one.{version ? ` Version ${version}.` : ""}
      </p>
    </div>
  );
}
