// Shared doc-shaping + fingerprinting for the Convex serving layer. Used by
// scripts/seed-convex.ts and the sync worker so both produce byte-identical
// docs and hashes (the Statbotics `changed()` pattern: recompute everything,
// persist only rows whose fingerprint moved).
import { createHash } from "node:crypto";
import type { ComputedData, TeamRow } from "./types";

export interface TeamDoc {
  team: number;
  numberStr: string;
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
}
export interface TrajectoryDoc {
  team: number;
  t0: number;
  events: { c: string; n: string | null; s: string | null }[];
  points: (number | null)[][];
}
export interface EventStatsDoc {
  code: string;
  rows: Record<string, (number | null)[]>;
}
export interface EventDoc {
  code: string;
  name: string | null;
  searchText: string;
  start: string | null;
  type: string;
  city: string | null;
  state: string | null;
  country: string | null;
}
export interface MetaDoc {
  computedAt: string;
  matchCount: number;
  teamCount: number;
  regions: string[];
  regionCounts: Record<string, number>;
  sortCounts: Record<string, number>;
  cyclePriors: { overallSec: number; byTypeSec: Record<string, number>; sampleCount: number } | null;
  simModel: unknown | null;
  worldRecord: {
    eventCode: string;
    eventName: string | null;
    eventStart: string | null;
    score: number;
    teams: { number: number; name: string }[];
  } | null;
}

export interface SiteDocs {
  meta: MetaDoc;
  teams: TeamDoc[];
  trajectories: TrajectoryDoc[];
  eventStats: EventStatsDoc[];
  events: EventDoc[];
}

/** Per-doc hashes. Teams carry two: `stats` ignores rank fields (quick-sync
 *  cadence), `full` covers the whole row (30-min rank reconcile). */
export interface Fingerprints {
  meta: string;
  teams: Record<string, { stats: string; full: string }>;
  trajectories: Record<string, string>;
  eventStats: Record<string, string>;
  events: Record<string, string>;
}

const hash = (value: unknown): string =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);

function teamDoc(numStr: string, r: TeamRow): TeamDoc {
  return {
    team: Number(numStr),
    numberStr: numStr,
    name: r.name,
    region: r.region,
    n: r.n,
    epa: r.epa,
    epaAuto: r.epaAuto,
    epaTele: r.epaTele,
    oprNp: r.oprNp,
    oprAuto: r.oprAuto,
    oprTele: r.oprTele,
    rkEpa: r.rkEpa,
    rkEpaAuto: r.rkEpaAuto,
    rkEpaTele: r.rkEpaTele,
    rkOprNp: r.rkOprNp,
    rkOprAuto: r.rkOprAuto,
    rkOprTele: r.rkOprTele,
  };
}

const SORT_KEYS = ["epa", "epaAuto", "epaTele", "oprNp", "oprAuto", "oprTele"] as const;
const RANK_OF: Record<(typeof SORT_KEYS)[number], keyof TeamDoc> = {
  epa: "rkEpa",
  epaAuto: "rkEpaAuto",
  epaTele: "rkEpaTele",
  oprNp: "rkOprNp",
  oprAuto: "rkOprAuto",
  oprTele: "rkOprTele",
};

/** Shape the computed season data into Convex docs + their fingerprints. */
export function buildSiteDocs(data: ComputedData): { docs: SiteDocs; fingerprints: Fingerprints } {
  const { rankings, trajectories, eventStats } = data;

  const teams = Object.entries(rankings.teams).map(([numStr, row]) => teamDoc(numStr, row));

  const regionCounts: Record<string, number> = {};
  const sortCounts: Record<string, number> = {};
  for (const key of SORT_KEYS) sortCounts[key] = 0;
  for (const t of teams) {
    if (t.region) regionCounts[t.region] = (regionCounts[t.region] ?? 0) + 1;
    for (const key of SORT_KEYS) if (t[RANK_OF[key]] != null) sortCounts[key]++;
  }

  const meta: MetaDoc = {
    computedAt: rankings.computedAt,
    matchCount: rankings.matchCount,
    teamCount: rankings.teamCount,
    regions: rankings.regions,
    regionCounts,
    sortCounts,
    cyclePriors: rankings.cyclePriors ?? null,
    simModel: rankings.simModel ?? null,
    worldRecord: rankings.worldRecord ?? null,
  };

  // Trajectories: localize each team's event references so the doc is
  // self-contained (points carry a LOCAL event index).
  const globalEvents = trajectories.events;
  const trajectoryDocs: TrajectoryDoc[] = Object.entries(trajectories.teams).map(
    ([numStr, points]) => {
      const localIdx = new Map<number, number>();
      const events: TrajectoryDoc["events"] = [];
      const localized = points.map((p) => {
        const gi = p[1];
        let li = localIdx.get(gi);
        if (li === undefined) {
          li = events.length;
          localIdx.set(gi, li);
          const ev = globalEvents[gi];
          events.push(ev ? { c: ev.c, n: ev.n, s: ev.s } : { c: "?", n: null, s: null });
        }
        const out: (number | null)[] = [...p] as (number | null)[];
        out[1] = li;
        return out;
      });
      return { team: Number(numStr), t0: trajectories.t0, events, points: localized };
    },
  );

  const eventStatsDocs: EventStatsDoc[] = Object.entries(eventStats.events).map(
    ([code, rows]) => ({ code, rows }),
  );

  const eventDocs: EventDoc[] = (rankings.events ?? []).map((e) => ({
    code: e.code,
    name: e.name,
    searchText: e.name ?? e.code,
    start: e.start,
    type: e.type,
    city: e.city,
    state: e.state,
    country: e.country,
  }));

  const fingerprints: Fingerprints = {
    meta: hash(meta),
    teams: {},
    trajectories: {},
    eventStats: {},
    events: {},
  };
  for (const t of teams) {
    const { rkEpa, rkEpaAuto, rkEpaTele, rkOprNp, rkOprAuto, rkOprTele, ...stats } = t;
    void rkEpa; void rkEpaAuto; void rkEpaTele; void rkOprNp; void rkOprAuto; void rkOprTele;
    fingerprints.teams[t.numberStr] = { stats: hash(stats), full: hash(t) };
  }
  for (const d of trajectoryDocs) fingerprints.trajectories[String(d.team)] = hash(d);
  for (const d of eventStatsDocs) fingerprints.eventStats[d.code] = hash(d);
  for (const d of eventDocs) fingerprints.events[d.code] = hash(d);

  return {
    docs: { meta, teams, trajectories: trajectoryDocs, eventStats: eventStatsDocs, events: eventDocs },
    fingerprints,
  };
}

/** Diff two fingerprint maps → keys whose docs must be (re)written. `mode`
 *  controls which team hash matters: quick syncs ignore rank-only drift. */
export function diffFingerprints(
  next: Fingerprints,
  prev: Fingerprints | null,
  mode: "stats" | "full",
): {
  meta: boolean;
  teams: string[];
  trajectories: string[];
  eventStats: string[];
  events: string[];
  removedTeams: string[];
  removedEvents: string[];
} {
  if (!prev) {
    return {
      meta: true,
      teams: Object.keys(next.teams),
      trajectories: Object.keys(next.trajectories),
      eventStats: Object.keys(next.eventStats),
      events: Object.keys(next.events),
      removedTeams: [],
      removedEvents: [],
    };
  }
  const teams = Object.keys(next.teams).filter((k) => {
    const p = prev.teams[k];
    if (!p) return true;
    return mode === "full" ? p.full !== next.teams[k].full : p.stats !== next.teams[k].stats;
  });
  const pick = (a: Record<string, string>, b: Record<string, string>) =>
    Object.keys(a).filter((k) => b[k] !== a[k]);
  return {
    meta: prev.meta !== next.meta,
    teams,
    trajectories: pick(next.trajectories, prev.trajectories),
    eventStats: pick(next.eventStats, prev.eventStats),
    events: pick(next.events, prev.events),
    removedTeams: Object.keys(prev.teams).filter((k) => !(k in next.teams)),
    removedEvents: Object.keys(prev.events).filter((k) => !(k in next.events)),
  };
}
