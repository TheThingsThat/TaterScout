import Link from "next/link";
import type { Metadata } from "next";
import {
  queryRankings,
  getRegions,
  isSortKey,
  type SortKey,
  type TeamRanking,
} from "@/lib/rankings";
import { CURRENT_SEASON, seasonName, seasonLabel } from "@/lib/season";
import { fmt } from "@/lib/format";
import { ensureLoaded } from "@/lib/data/store";
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

const MONO_TH =
  "px-3 py-3.5 text-right font-mono text-[10px] font-bold uppercase tracking-[0.1em]";

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

  await ensureLoaded(CURRENT_SEASON); // hydrate the data store before sync accessors

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

  const headerHref = (key: SortKey) =>
    qs({ sort: key, dir: key === sort && dir === "desc" ? "asc" : "desc", page: 1 });
  const arrow = (key: SortKey) =>
    key === sort ? (dir === "desc" ? " ↓" : " ↑") : "";
  const colColor = (kind: "epa" | "opr", active: boolean) =>
    active ? (kind === "epa" ? "#2f8bff" : "#3ecf76") : "#6b6f78";

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
    `rounded-md border border-[#1a1a1a] px-2 py-1 ${
      disabled ? "pointer-events-none opacity-40" : "hover:text-foreground"
    }`;

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-6 pt-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6b6f78]">
            Leaderboard
          </div>
          <h1 className="mt-2.5 text-[clamp(32px,4vw,46px)] font-semibold tracking-[-0.01em] text-[#f7f8fa]">
            Rankings
          </h1>
          <p className="mt-2 text-[14px] text-muted">
            {seasonName(CURRENT_SEASON)} · {seasonLabel(CURRENT_SEASON)} ·{" "}
            {total.toLocaleString()} teams {region ? `in ${region}` : "worldwide"}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#6b6f78]">
            Region
          </span>
          <RegionSelect regions={regions} value={region} />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-[18px] border border-[#1a1a1a] bg-surface">
        <div className="ts-scroll overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#1f1f1f]">
                <th className="px-4 py-3.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">
                  #
                </th>
                <th className="px-4 py-3.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">
                  Team
                </th>
                <th className="px-3 py-3.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">
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
                  className="border-b border-[#141414] transition-colors last:border-0 hover:bg-[#101010]"
                >
                  <td className="px-4 py-[11px] font-mono text-[#6b6f78]">
                    {(curPage - 1) * PAGE_SIZE + i + 1}
                  </td>
                  <td className="px-4 py-[11px]">
                    <Link
                      href={`/teams/${r.number}?season=${CURRENT_SEASON}`}
                      className="no-underline hover:text-accent"
                    >
                      <span className="font-mono text-[#6b6f78]">{r.number}</span>{" "}
                      <span className="font-medium text-[#e7eaf0]">{r.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-[11px] text-[#8a90a0]">{r.region ?? "—"}</td>
                  {COLS.map((c) => cell(r, c.key, c.kind))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[#1a1a1a] px-4 py-[13px] text-[12px] text-[#6b6f78]">
          <span>
            EPA &amp; no-penalty OPR computed by TaterScout from {CURRENT_SEASON}{" "}
            match data.
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
