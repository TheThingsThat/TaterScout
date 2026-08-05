import { type SimModel, DEFAULT_SIM_MODEL } from "@/lib/predict/model";
import { getRankingsData, ensureLoaded } from "@/lib/data/store";
import { convexBackendEnabled } from "@/lib/data/backend";
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

type Row = Omit<TeamRanking, "number">;

interface CyclePriors {
  overallSec: number;
  byTypeSec: Record<string, number>;
  sampleCount: number;
}

interface FileShape {
  season: number;
  computedAt: string;
  matchCount: number;
  teamCount: number;
  regions: string[];
  cyclePriors?: CyclePriors;
  simModel?: SimModel;
  teams: Record<string, Row>;
}

// File backend: load-on-demand from the in-process store (bundled JSON / Blob).
async function file(season: number): Promise<FileShape | null> {
  await ensureLoaded(season);
  return getRankingsData(season) as unknown as FileShape | null;
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
  if (convexBackendEnabled()) {
    const r = await siteMeta(season);
    if (r) {
      const cp = r.v?.cyclePriors;
      if (!cp) return 330;
      if (eventType && cp.byTypeSec[eventType] != null) return cp.byTypeSec[eventType];
      return cp.overallSec;
    }
  }
  const cp = (await file(season))?.cyclePriors;
  if (!cp) return 330; // hard fallback if not yet precomputed
  if (eventType && cp.byTypeSec[eventType] != null) return cp.byTypeSec[eventType];
  return cp.overallSec;
}

/** Season win/score/RP model for the event simulator. */
export async function getSimModel(season: number): Promise<SimModel> {
  if (convexBackendEnabled()) {
    const r = await siteMeta(season);
    if (r) return (r.v?.simModel as SimModel | null) ?? DEFAULT_SIM_MODEL;
  }
  return (await file(season))?.simModel ?? DEFAULT_SIM_MODEL;
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

export const SORT_LABELS: Record<SortKey, string> = {
  epa: "Total EPA",
  epaAuto: "Auto EPA",
  epaTele: "TeleOp EPA",
  oprNp: "Total OPR",
  oprAuto: "Auto OPR",
  oprTele: "TeleOp OPR",
};

export function isSortKey(s: string | undefined): s is SortKey {
  return !!s && (SORT_KEYS as readonly string[]).includes(s);
}

export async function getTeamRanking(season: number, num: number): Promise<TeamRanking | null> {
  if (convexBackendEnabled()) {
    const r = await siteTeamRow(season, num);
    if (r) return r.v ? docToRanking(r.v) : null;
  }
  const f = await file(season);
  const r = f?.teams[String(num)];
  return r ? { number: num, ...r } : null;
}

export async function getTeamCount(season: number): Promise<number> {
  if (convexBackendEnabled()) {
    const r = await siteMeta(season);
    if (r) return r.v?.teamCount ?? 0;
  }
  return (await file(season))?.teamCount ?? 0;
}

export async function getRegions(season: number): Promise<string[]> {
  if (convexBackendEnabled()) {
    const r = await siteMeta(season);
    if (r) return r.v?.regions ?? [];
  }
  return (await file(season))?.regions ?? [];
}

export async function hasRankings(season: number): Promise<boolean> {
  if (convexBackendEnabled()) {
    const r = await siteMeta(season);
    if (r) return r.v != null;
  }
  return !!(await file(season));
}

/** Lookup a set of teams (for event pages). */
export async function getRankingMap(
  season: number,
  teamNumbers: number[],
): Promise<Map<number, TeamRanking>> {
  const out = new Map<number, TeamRanking>();
  if (teamNumbers.length === 0) return out;
  if (convexBackendEnabled() && teamNumbers.length <= 250) {
    const r = await siteTeamRows(season, teamNumbers);
    if (r) {
      for (const doc of r.v) out.set(doc.team, docToRanking(doc));
      return out;
    }
  }
  const f = await file(season);
  if (!f) return out;
  for (const n of teamNumbers) {
    const r = f.teams[String(n)];
    if (r) out.set(n, { number: n, ...r });
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
  if (convexBackendEnabled()) {
    const r = await sitePage(season, {
      sort: q.sort,
      dir: q.dir,
      region: q.region ?? null,
      page: q.page,
      pageSize: q.pageSize,
    });
    if (r) {
      return {
        rows: r.v.rows.map(docToRanking),
        total: r.v.total,
        page: r.v.page,
        pages: r.v.pages,
      };
    }
  }
  const f = await file(season);
  if (!f) return { rows: [], total: 0, page: 1, pages: 0 };

  let rows: TeamRanking[] = Object.entries(f.teams).map(([n, r]) => ({
    number: Number(n),
    ...r,
  }));
  if (q.region) rows = rows.filter((r) => r.region === q.region);

  const k = q.sort;
  rows = rows.filter((r) => r[k] !== null);
  const mul = q.dir === "asc" ? -1 : 1;
  rows.sort((a, b) => ((b[k] as number) - (a[k] as number)) * mul);

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(Math.max(1, q.page), pages);
  const start = (page - 1) * q.pageSize;
  return { rows: rows.slice(start, start + q.pageSize), total, page, pages };
}
