import Link from "next/link";
import type { Metadata } from "next";
import {
  queryRankings,
  getRegions,
  isSortKey,
  type SortKey,
  type TeamRanking,
} from "@/lib/rankings";
import {
  CURRENT_SEASON,
  allSeasons,
  parseSeasonParam,
  ratingsCoverageNote,
  seasonName,
  seasonLabel,
} from "@/lib/season";
import { fmt } from "@/lib/format";
import { scheduleAutoRefresh } from "@/lib/data/autoRefresh";
import RegionSelect from "@/components/RegionSelect";
import RegionStarButton from "@/components/RegionStarButton";

export const metadata: Metadata = {
  title: "Rankings",
  description: "FTC team rankings by EPA and OPR, filterable by region.",
};

const PAGE_SIZE = 50;

const COLS: { key: SortKey; label: string; kind: "epa" | "opr" }[] = [
  { key: "epa", label: "EPA", kind: "epa" },
  { key: "epaAuto", label: "Auto", kind: "epa" },
  { key: "epaTele", label: "Tele", kind: "epa" },
  { key: "oprNp", label: "NP OPR", kind: "opr" },
  { key: "oprAuto", label: "Auto", kind: "opr" },
  { key: "oprTele", label: "Tele", kind: "opr" },
];

const MONO_TH =
  "px-3 py-3.5 text-right font-mono text-[10px] font-bold uppercase tracking-[0.1em]";

interface Props {
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    region?: string;
    page?: string;
    season?: string;
  }>;
}

export default async function RankingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const sort: SortKey = isSortKey(sp.sort) ? sp.sort : "epa";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const region = sp.region ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const season = parseSeasonParam(sp.season);

  scheduleAutoRefresh(CURRENT_SEASON); // post-response staleness check (never blocks)

  // Accessors are backend-aware (Convex or bundled files) and self-loading.
  const regions = await getRegions(season);
  const { rows, total, page: curPage, pages } = await queryRankings(season, {
    region: region || null,
    sort,
    dir,
    page,
    pageSize: PAGE_SIZE,
  });

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (season !== CURRENT_SEASON) p.set("season", String(season));
    p.set("sort", String(over.sort ?? sort));
    p.set("dir", String(over.dir ?? dir));
    if (region) p.set("region", region);
    p.set("page", String(over.page ?? 1));
    return `/rankings?${p.toString()}`;
  };

  const headerHref = (key: SortKey) =>
    qs({ sort: key, dir: key === sort && dir === "desc" ? "asc" : "desc", page: 1 });
  const arrow = (key: SortKey) =>
    key === sort ? (dir === "desc" ? " ↓" : " ↑") : "";
  const colColor = (kind: "epa" | "opr", active: boolean) =>
    active ? (kind === "epa" ? "var(--epa)" : "var(--opr)") : "var(--dim)";

  const cell = (r: TeamRanking, key: SortKey, kind: "epa" | "opr") => {
    const active = key === sort;
    return (
      <td
        key={key}
        className="px-3 py-[11px] text-right tabular-nums"
        style={{ color: colColor(kind, active), fontWeight: active ? 600 : 400 }}
      >
        {fmt(r[key])}
      </td>
    );
  };

  const pagerBtn = (disabled: boolean) =>
    `rounded-md border border-border px-2 py-1 ${
      disabled ? "pointer-events-none opacity-40" : "hover:text-foreground"
    }`;

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-6 pt-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
            Leaderboard
          </div>
          <h1 className="mt-2.5 text-[clamp(32px,4vw,46px)] font-semibold tracking-[-0.01em] text-heading">
            Rankings
          </h1>
          <p className="mt-2 text-[14px] text-muted">
            {seasonName(season)} · {seasonLabel(season)} ·{" "}
            {total.toLocaleString()} teams {region ? `in ${region}` : "worldwide"}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {allSeasons().map((s) => (
              <Link
                key={s}
                href={s === CURRENT_SEASON ? "/rankings" : `/rankings?season=${s}`}
                className="rounded-[10px] px-3 py-1.5 text-[13px] transition-colors"
                style={
                  s === season
                    ? { background: "var(--accent)", border: "1px solid var(--accent)", color: "#fff", fontWeight: 500 }
                    : { border: "1px solid var(--border-strong)", color: "var(--muted)" }
                }
              >
                {seasonLabel(s)}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
            Region
          </span>
          <RegionSelect regions={regions} value={region} />
          {region && season === CURRENT_SEASON && <RegionStarButton region={region} />}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-[18px] border border-border bg-surface">
        <div className="ts-scroll overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim">
                  #
                </th>
                <th className="px-4 py-3.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim">
                  Team
                </th>
                <th className="px-3 py-3.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim">
                  Region
                </th>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    className={MONO_TH}
                    style={{ color: colColor(c.kind, c.key === sort) }}
                  >
                    <Link href={headerHref(c.key)} className="hover:underline">
                      {c.label}
                      {arrow(c.key)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.number}
                  className="border-b border-line transition-colors last:border-0 hover:bg-hover"
                >
                  <td className="px-4 py-[11px] font-mono text-dim">
                    {(curPage - 1) * PAGE_SIZE + i + 1}
                  </td>
                  <td className="px-4 py-[11px]">
                    <Link
                      prefetch={false}
                      href={`/teams/${r.number}?season=${season}`}
                      className="no-underline hover:text-accent"
                    >
                      <span className="font-mono text-dim">{r.number}</span>{" "}
                      <span className="font-medium text-body">{r.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-[11px] text-muted">{r.region ?? "—"}</td>
                  {COLS.map((c) => cell(r, c.key, c.kind))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-[13px] text-[12px] text-dim">
          <span>
            EPA &amp; no-penalty OPR computed by TaterScout from {seasonLabel(season)}{" "}
            match data.{ratingsCoverageNote(season) ? ` ${ratingsCoverageNote(season)}` : ""}
          </span>
          <div className="flex items-center gap-3">
            <span className="font-mono">
              Page {curPage} / {pages}
            </span>
            <Link href={qs({ page: Math.max(1, curPage - 1) })} className={pagerBtn(curPage <= 1)}>
              ← Prev
            </Link>
            <Link href={qs({ page: Math.min(pages, curPage + 1) })} className={pagerBtn(curPage >= pages)}>
              Next →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
