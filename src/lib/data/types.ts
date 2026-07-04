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
  type: string; // event type (LeagueMeet/Qualifier/Championship…) — for cycle priors
  updatedAt: string | null; // max match modifiedOn — change signal
  city?: string | null;
  state?: string | null;
  country?: string | null;
  matches: RawMatch[];
  // Teams that appeared at the event; region = the team's FIRST homeRegion.
  teams: { num: number; name: string; region: string | null }[];
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

// Highest no-penalty match score of the season (home-page "world record").
export interface WorldRecordData {
  eventCode: string;
  eventName: string | null;
  eventStart: string | null;
  score: number; // no-penalty alliance total
  teams: { number: number; name: string }[];
}

// Lightweight event row for the local search index (FIRST has no fuzzy search).
export interface EventIndexRow {
  code: string;
  name: string | null;
  start: string | null;
  type: string;
  city: string | null;
  state: string | null;
  country: string | null;
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
  worldRecord?: WorldRecordData | null;
  events?: EventIndexRow[];
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
