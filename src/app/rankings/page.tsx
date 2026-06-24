import Link from "next/link";
import type { Metadata } from "next";
import {
  queryRankings,
  getRegions,
  isSortKey,
  type SortKey,
  type TeamRanking,
} from "@/lib/rankings";
import { CURRENT_SEASON, seasonFull } from "@/lib/season";
import { fmt } from "@/lib/format";
import RegionSelect from "@/components/RegionSelect";

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

interface Props {
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    region?: string;
    page?: string;
  }>;
}

export default async function RankingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const sort: SortKey = isSortKey(sp.sort) ? sp.sort : "epa";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const region = sp.region ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const regions = getRegions(CURRENT_SEASON);
  const { rows, total, page: curPage, pages } = queryRankings(CURRENT_SEASON, {
    region: region || null,
    sort,
    dir,
    page,
    pageSize: PAGE_SIZE,
  });

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    p.set("sort", String(over.sort ?? sort));
    p.set("dir", String(over.dir ?? dir));
    if (region) p.set("region", region);
    p.set("page", String(over.page ?? 1));
    return `/rankings?${p.toString()}`;
  };

  // Header link: clicking the active column flips direction, else desc.
  const headerHref = (key: SortKey) =>
    qs({ sort: key, dir: key === sort && dir === "desc" ? "asc" : "desc", page: 1 });

  const arrow = (key: SortKey) =>
    key === sort ? (dir === "desc" ? " ↓" : " ↑") : "";

  const cell = (r: TeamRanking, key: SortKey) => {
    const active = key === sort;
    const kind = COLS.find((c) => c.key === key)!.kind;
    return (
      <td
        key={key}
        className={`px-3 py-2 text-right tabular-nums ${
          active
            ? kind === "epa"
              ? "font-semibold text-accent-2"
              : "font-semibold text-accent"
            : "text-muted"
        }`}
      >
        {fmt(r[key])}
      </td>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rankings</h1>
          <p className="mt-1 text-sm text-muted">
            {seasonFull(CURRENT_SEASON)} · {total.toLocaleString()} teams
            {region ? ` in ${region}` : " worldwide"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RegionSelect regions={regions} value={region} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 text-left font-medium">#</th>
                <th className="px-4 py-2.5 text-left font-medium">Team</th>
                <th className="px-3 py-2.5 text-left font-medium">Region</th>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    className={`px-3 py-2.5 text-right font-medium ${
                      c.key === sort
                        ? c.kind === "epa"
                          ? "text-accent-2"
                          : "text-accent"
                        : ""
                    }`}
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
                  className="border-b border-border/50 last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2 tabular-nums text-muted">
                    {(curPage - 1) * PAGE_SIZE + i + 1}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/teams/${r.number}?season=${CURRENT_SEASON}`}
                      className="hover:text-accent"
                    >
                      <span className="font-mono text-muted">{r.number}</span>{" "}
                      <span className="font-medium">{r.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted">{r.region ?? "—"}</td>
                  {COLS.map((c) => cell(r, c.key))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted">
          <span>
            EPA &amp; no-penalty OPR computed by VibeScout from{" "}
            {CURRENT_SEASON} match data.
          </span>
          <div className="flex items-center gap-3">
            <span>
              Page {curPage} / {pages}
            </span>
            <Link
              href={qs({ page: Math.max(1, curPage - 1) })}
              aria-disabled={curPage <= 1}
              className={`rounded-md border border-border px-2 py-1 ${
                curPage <= 1
                  ? "pointer-events-none opacity-40"
                  : "hover:text-foreground"
              }`}
            >
              ← Prev
            </Link>
            <Link
              href={qs({ page: Math.min(pages, curPage + 1) })}
              aria-disabled={curPage >= pages}
              className={`rounded-md border border-border px-2 py-1 ${
                curPage >= pages
                  ? "pointer-events-none opacity-40"
                  : "hover:text-foreground"
              }`}
            >
              Next →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
