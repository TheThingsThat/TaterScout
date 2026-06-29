// In-process data store over a pluggable backend (local files in dev, Vercel
// Blob in prod — see storage.ts). Reads are served from a short-lived in-memory
// cache so the public accessors stay SYNC; a page calls `await ensureLoaded()`
// once before using them. A refresh updates the cache in place and persists.
import type { ComputedData, RankingsFile, TrajFile, EventStatsFile, RawEvent } from "./types";
import { readDataset, writeDataset } from "./storage";

const TTL_MS = 60_000; // re-read datasets at most this often per instance

interface Slot {
  data: ComputedData | null;
  at: number; // last load time (0 = never)
}
const computed = new Map<number, Slot>();
const raw = new Map<number, RawEvent[] | null>();

/** Load the three computed datasets into memory if missing or stale. Call this
 *  (awaited) in a server component before using the sync getters below. */
export async function ensureLoaded(season: number): Promise<void> {
  const cur = computed.get(season);
  if (cur && Date.now() - cur.at < TTL_MS) return;
  const [r, t, e] = await Promise.all([
    readDataset(`rankings-${season}`),
    readDataset(`trajectories-${season}`),
    readDataset(`event-stats-${season}`),
  ]);
  if (r && t && e) {
    computed.set(season, {
      data: {
        rankings: JSON.parse(r) as RankingsFile,
        trajectories: JSON.parse(t) as TrajFile,
        eventStats: JSON.parse(e) as EventStatsFile,
      },
      at: Date.now(),
    });
  } else if (!cur) {
    computed.set(season, { data: null, at: Date.now() }); // none yet
  }
  // On partial failure with an existing slot, keep the stale data.
}

export function getRankingsData(season: number): RankingsFile | null {
  return computed.get(season)?.data?.rankings ?? null;
}
export function getTrajectoriesData(season: number): TrajFile | null {
  return computed.get(season)?.data?.trajectories ?? null;
}
export function getEventStatsData(season: number): EventStatsFile | null {
  return computed.get(season)?.data?.eventStats ?? null;
}

/** The ingested raw event/match set (refresh working copy). Null if not seeded. */
export async function getRawEvents(season: number): Promise<RawEvent[] | null> {
  if (raw.has(season)) return raw.get(season)!;
  const s = await readDataset(`raw-${season}`);
  const parsed = s ? (JSON.parse(s) as RawEvent[]) : null;
  raw.set(season, parsed);
  return parsed;
}

/** Replace in-memory data so a refresh is visible immediately within this instance. */
export function applyComputed(season: number, rawEvents: RawEvent[], data: ComputedData): void {
  computed.set(season, { data, at: Date.now() });
  raw.set(season, rawEvents);
}

/** Persist the current in-memory data to the backend (Blob or files). */
export async function persist(season: number): Promise<void> {
  const data = computed.get(season)?.data;
  const rawEvents = raw.get(season);
  if (!data || !rawEvents) return;
  await Promise.all([
    writeDataset(`rankings-${season}`, JSON.stringify(data.rankings)),
    writeDataset(`trajectories-${season}`, JSON.stringify(data.trajectories)),
    writeDataset(`event-stats-${season}`, JSON.stringify(data.eventStats)),
    writeDataset(`raw-${season}`, JSON.stringify(rawEvents)),
  ]);
}
