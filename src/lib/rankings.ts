import { type SimModel, DEFAULT_SIM_MODEL } from "@/lib/predict/model";
import { getRankingsData } from "@/lib/data/store";

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

// Read from the in-process store (refreshable at runtime) rather than a static
// import, so a refresh is reflected without a server restart.
function file(season: number): FileShape | null {
  return getRankingsData(season) as unknown as FileShape | null;
}

/** Dynamic season baseline cycle (seconds) for match-time prediction: the
 *  per-event-type value when available, else the overall season value. */
export function getSeasonCyclePrior(season: number, eventType?: string): number {
  const cp = file(season)?.cyclePriors;
  if (!cp) return 330; // hard fallback if not yet precomputed
  if (eventType && cp.byTypeSec[eventType] != null) return cp.byTypeSec[eventType];
  return cp.overallSec;
}

/** Season win/score/RP model for the event simulator. */
export function getSimModel(season: number): SimModel {
  return file(season)?.simModel ?? DEFAULT_SIM_MODEL;
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

export function getTeamRanking(
  season: number,
  num: number,
): TeamRanking | null {
  const f = file(season);
  const r = f?.teams[String(num)];
  return r ? { number: num, ...r } : null;
}

export function getTeamCount(season: number): number {
  return file(season)?.teamCount ?? 0;
}

export function getRegions(season: number): string[] {
  return file(season)?.regions ?? [];
}

export function hasRankings(season: number): boolean {
  return !!file(season);
}

/** Lookup a set of teams (for event pages). */
export function getRankingMap(
  season: number,
  teamNumbers: number[],
): Map<number, TeamRanking> {
  const f = file(season);
  const out = new Map<number, TeamRanking>();
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

export function queryRankings(
  season: number,
  q: RankingQuery,
): { rows: TeamRanking[]; total: number; page: number; pages: number } {
  const f = file(season);
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
