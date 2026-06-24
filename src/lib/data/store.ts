// In-process data store: the single source of truth the app reads from, and the
// thing a refresh updates in place (so new data shows without a server restart).
// Backed by the on-disk JSON files; sync-loaded so the read accessors stay sync.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type {
  ComputedData,
  RankingsFile,
  TrajFile,
  EventStatsFile,
  RawEvent,
} from "./types";

// Raw-cache schema version. v6 adds Event.type + Event.updatedAt to each RawEvent.
export const RAW_VERSION = "v6";

function dataDir(): string {
  return process.env.VIBESCOUT_DATA_DIR || path.join(process.cwd(), "src", "data");
}
const rankingsPath = (s: number) => path.join(dataDir(), `rankings-${s}.json`);
const trajPath = (s: number) => path.join(dataDir(), `trajectories-${s}.json`);
const evstatsPath = (s: number) => path.join(dataDir(), `event-stats-${s}.json`);
export const rawPath = (s: number) => `/tmp/vibescout-raw-${s}-${RAW_VERSION}.json`;

interface SeasonCache {
  computed: ComputedData | null;
  computedTried: boolean;
  raw: RawEvent[] | null;
  rawTried: boolean;
}
const cache = new Map<number, SeasonCache>();
function slot(season: number): SeasonCache {
  let c = cache.get(season);
  if (!c) {
    c = { computed: null, computedTried: false, raw: null, rawTried: false };
    cache.set(season, c);
  }
  return c;
}

function loadComputed(season: number): ComputedData | null {
  const c = slot(season);
  if (c.computed || c.computedTried) return c.computed;
  c.computedTried = true;
  try {
    c.computed = {
      rankings: JSON.parse(readFileSync(rankingsPath(season), "utf8")) as RankingsFile,
      trajectories: JSON.parse(readFileSync(trajPath(season), "utf8")) as TrajFile,
      eventStats: JSON.parse(readFileSync(evstatsPath(season), "utf8")) as EventStatsFile,
    };
  } catch {
    c.computed = null;
  }
  return c.computed;
}

export function getRankingsData(season: number): RankingsFile | null {
  return loadComputed(season)?.rankings ?? null;
}
export function getTrajectoriesData(season: number): TrajFile | null {
  return loadComputed(season)?.trajectories ?? null;
}
export function getEventStatsData(season: number): EventStatsFile | null {
  return loadComputed(season)?.eventStats ?? null;
}

/** The ingested raw event/match set (the refresh's working copy). Null if no
 *  raw cache exists yet (would require a full crawl to seed). */
export function getRawEvents(season: number): RawEvent[] | null {
  const c = slot(season);
  if (c.raw || c.rawTried) return c.raw;
  c.rawTried = true;
  try {
    c.raw = JSON.parse(readFileSync(rawPath(season), "utf8")) as RawEvent[];
  } catch {
    c.raw = null;
  }
  return c.raw;
}

/** Replace the in-memory raw + computed data (makes a refresh immediately visible). */
export function applyComputed(season: number, raw: RawEvent[], computed: ComputedData): void {
  const c = slot(season);
  c.raw = raw;
  c.rawTried = true;
  c.computed = computed;
  c.computedTried = true;
}

/** Write the current in-memory data back to disk (survives a restart). */
export function persist(season: number): void {
  const c = slot(season);
  if (!c.computed || !c.raw) return;
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(rankingsPath(season), JSON.stringify(c.computed.rankings));
  writeFileSync(trajPath(season), JSON.stringify(c.computed.trajectories));
  writeFileSync(evstatsPath(season), JSON.stringify(c.computed.eventStats));
  writeFileSync(rawPath(season), JSON.stringify(c.raw));
}
