// The sync worker's persistent state: the full-season raw events plus the
// fingerprint map from the last successful push, as ONE gzipped object
// (~2MB vs ~11MB raw). Keeping fingerprints WITH the raw data they derive from
// means diffing costs zero Convex reads. Memory-first per instance; re-read
// from storage only when another instance has synced since our copy was saved
// (caller checks syncMeta.lastChangedAt).
import { gzipSync, gunzipSync } from "node:zlib";
import { readDatasetRaw, writeDatasetRaw, readDataset } from "./storage";
import type { RawEvent } from "./types";
import type { Fingerprints } from "./fingerprint";

export interface WorkerState {
  savedAt: number;
  events: RawEvent[];
  fingerprints: Fingerprints | null; // null → everything gets (re)written
}

const cache = new Map<number, WorkerState>();

/** Load worker state. Falls back to adopting a legacy raw-{season} cache (from
 *  scripts/build-epa.ts) with null fingerprints, which forces a full first push. */
export async function loadWorkerState(
  season: number,
  opts: { staleIfSavedBefore?: number } = {},
): Promise<WorkerState | null> {
  const mem = cache.get(season);
  if (mem && !(opts.staleIfSavedBefore && mem.savedAt < opts.staleIfSavedBefore)) return mem;

  const buf = await readDatasetRaw(`worker-${season}`);
  if (buf) {
    try {
      const state = JSON.parse(gunzipSync(buf).toString("utf8")) as WorkerState;
      cache.set(season, state);
      return state;
    } catch {
      /* corrupt — fall through to legacy adoption */
    }
  }
  // Keep a fresher in-memory copy over a missing/older stored one.
  if (mem) return mem;

  const legacy = await readDataset(`raw-${season}`);
  if (legacy) {
    try {
      const events = JSON.parse(legacy) as RawEvent[];
      const state: WorkerState = { savedAt: 0, events, fingerprints: null };
      cache.set(season, state);
      return state;
    } catch {
      return null;
    }
  }
  return null;
}

export async function saveWorkerState(season: number, state: WorkerState): Promise<void> {
  cache.set(season, state);
  await writeDatasetRaw(`worker-${season}`, gzipSync(Buffer.from(JSON.stringify(state)), { level: 6 }));
}
