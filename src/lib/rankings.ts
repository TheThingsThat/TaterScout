import { type SimModel, DEFAULT_SIM_MODEL } from "@/lib/predict/model";
import { siteMeta, sitePage, siteTeamRow, siteTeamRows } from "@/lib/data/convexSite";

export interface TeamRanking {
  number: number;
  name: string;
  region: string | null;
  n: number;
  oprNp: number | null;
  oprAuto: number | null;
  oprTele: number | null;
  epa: number | null;
  epaAuto: number | null;
  epaTele: number | null;
  rkOprNp: number | null;
  rkOprAuto: number | null;
  rkOprTele: number | null;
  rkEpa: number | null;
  rkEpaAuto: number | null;
  rkEpaTele: number | null;
}

// Convex doc -> the site-wide TeamRanking shape.
function docToRanking(d: {
  team: number;
  name: string;
  region: string | null;
  n: number;
  epa: number | null;
  epaAuto: number | null;
  epaTele: number | null;
  oprNp: number | null;
  oprAuto: number | null;
  oprTele: number | null;
  rkEpa: number | null;
  rkEpaAuto: number | null;
  rkEpaTele: number | null;
  rkOprNp: number | null;
  rkOprAuto: number | null;
  rkOprTele: number | null;
}): TeamRanking {
  return {
    number: d.team,
    name: d.name,
    region: d.region,
    n: d.n,
    epa: d.epa,
    epaAuto: d.epaAuto,
    epaTele: d.epaTele,
    oprNp: d.oprNp,
    oprAuto: d.oprAuto,
    oprTele: d.oprTele,
    rkEpa: d.rkEpa,
    rkEpaAuto: d.rkEpaAuto,
    rkEpaTele: d.rkEpaTele,
    rkOprNp: d.rkOprNp,
    rkOprAuto: d.rkOprAuto,
    rkOprTele: d.rkOprTele,
  };
}

/** Dynamic season baseline cycle (seconds) for match-time prediction. */
export async function getSeasonCyclePrior(season: number, eventType?: string): Promise<number> {
  const cp = (await siteMeta(season))?.v?.cyclePriors;
  if (!cp) return 330; // hard fallback if not yet precomputed / Convex down
  if (eventType && cp.byTypeSec[eventType] != null) return cp.byTypeSec[eventType];
  return cp.overallSec;
}

/** Season win/score/RP model for the event simulator. */
export async function getSimModel(season: number): Promise<SimModel> {
  const r = await siteMeta(season);
  return (r?.v?.simModel as SimModel | null) ?? DEFAULT_SIM_MODEL;
}

export const SORT_KEYS = [
  "epa",
  "epaAuto",
  "epaTele",
  "oprNp",
  "oprAuto",
  "oprTele",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export function isSortKey(s: string | undefined): s is SortKey {
  return !!s && (SORT_KEYS as readonly string[]).includes(s);
}

export async function getTeamRanking(season: number, num: number): Promise<TeamRanking | null> {
  const r = await siteTeamRow(season, num);
  return r?.v ? docToRanking(r.v) : null;
}

export async function getTeamCount(season: number): Promise<number> {
  return (await siteMeta(season))?.v?.teamCount ?? 0;
}

export async function getRegions(season: number): Promise<string[]> {
  return (await siteMeta(season))?.v?.regions ?? [];
}

/** Lookup a set of teams (for event pages). Chunked so an oversized roster
 *  can't blow past the per-query team cap. */
export async function getRankingMap(
  season: number,
  teamNumbers: number[],
): Promise<Map<number, TeamRanking>> {
  const out = new Map<number, TeamRanking>();
  for (let i = 0; i < teamNumbers.length; i += 250) {
    const r = await siteTeamRows(season, teamNumbers.slice(i, i + 250));
    if (r) for (const doc of r.v) out.set(doc.team, docToRanking(doc));
  }
  return out;
}

export interface RankingQuery {
  region?: string | null;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export async function queryRankings(
  season: number,
  q: RankingQuery,
): Promise<{ rows: TeamRanking[]; total: number; page: number; pages: number }> {
  const r = await sitePage(season, {
    sort: q.sort,
    dir: q.dir,
    region: q.region ?? null,
    page: q.page,
    pageSize: q.pageSize,
  });
  if (!r) return { rows: [], total: 0, page: 1, pages: 0 }; // Convex unavailable
  return {
    rows: r.v.rows.map(docToRanking),
    total: r.v.total,
    page: r.v.page,
    pages: r.v.pages,
  };
}
