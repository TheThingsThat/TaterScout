// Shared data types for the precompute + incremental-refresh pipeline.
// Used by both the offline CLI (scripts/build-epa.ts) and the runtime refresh
// route (src/app/api/refresh), so imports here stay relative (tsx-friendly).
import type { SimModel } from "../predict/model";

// --- Raw crawl shapes (the ingested FTCScout data = our "database") ---
export interface RawMatch {
  key: string; // unique within the dataset: `${eventCode}-${index}` (recomputed on ingest)
  time: number; // ms since epoch (actual or scheduled start)
  level: string; // tournamentLevel ("Quals", "DoubleElim", "Finals", …)
  num: number; // matchNum (real competition number, e.g. Q15 → 15)
  series: number; // playoff series (0 for quals)
  red: number[];
  blue: number[];
  ra: number;
  rt: number; // red auto, red teleop (no-penalty)
  ba: number;
  bt: number;
  rrp: number[]; // red bonus RPs [movement, goal, pattern]
  brp: number[]; // blue bonus RPs
}

export interface RawEvent {
  code: string;
  name: string | null;
  start: string | null;
  region: string | null;
  type: string; // event type (LeagueMeet/Qualifier/Championship…) — for cycle priors
  updatedAt: string | null; // FTCScout Event.updatedAt — the change watermark
  matches: RawMatch[];
  // opr = FTCScout per-event OPR [totalPointsNp, autoPoints, dcPoints] (null if none).
  teams: { num: number; name: string; opr: [number, number, number] | null }[];
}

// --- Computed file shapes (the JSON the app reads) ---
export interface CyclePriors {
  overallSec: number;
  byTypeSec: Record<string, number>;
  sampleCount: number;
}

export interface TeamRow {
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

export interface RankingsFile {
  season: number;
  computedAt: string;
  matchCount: number;
  teamCount: number;
  regions: string[];
  cyclePriors?: CyclePriors;
  simModel?: SimModel;
  teams: Record<string, TeamRow>;
}

// [tMinutes, eventIdx, playoff, epaAuto, epaTele, oprAuto|null, oprTele|null, noShow?, matchNum?, series?]
export type TrajRawPoint = [
  number, number, number, number, number,
  number | null, number | null, number?, number?, number?,
];

export interface TrajFile {
  season: number;
  t0: number;
  events: { c: string; n: string | null; s: string | null }[];
  teams: Record<string, TrajRawPoint[]>;
}

// [preTot, preAuto, postTot, postAuto, oprNp, oprAuto]
export type EventStatsRow = (number | null)[];

export interface EventStatsFile {
  season: number;
  events: Record<string, Record<string, EventStatsRow>>;
}

export interface ComputedData {
  rankings: RankingsFile;
  trajectories: TrajFile;
  eventStats: EventStatsFile;
}
