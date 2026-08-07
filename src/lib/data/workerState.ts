// The sync worker's persistent state: the full-season raw events plus the
// fingerprint map from the last successful push, as ONE gzipped object
// (~2MB vs ~11MB raw). Keeping fingerprints WITH the raw data they derive from
// means diffing costs zero Convex reads.
//
// Source of truth is Convex file storage (sync/state.ts) — any instance can
// adopt the newest state and no external blob store is involved. Memory and a
// /tmp file act as per-instance caches; the caller passes lastChangedAt as
// `staleIfSavedBefore` so a cache older than the last cross-instance push is
// skipped in favor of the Convex copy.
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { api } from "@convex/_generated/api";
import type { SyncTarget } from "./syncPush";
import type { RawEvent } from "./types";
import type { Fingerprints } from "./fingerprint";

export interface WorkerState {
  savedAt: number;
  events: RawEvent[];
  fingerprints: Fingerprints | null; // null → everything gets (re)written
}

// Bump when the raw-crawl schema changes (keeps old caches from being adopted).
const RAW_VERSION = "v7";
const tmpPath = (season: number) => `/tmp/vibescout-worker-${season}-${RAW_VERSION}.gz`;

const cache = new Map<number, WorkerState>();

const decode = (buf: Buffer): WorkerState =>
  JSON.parse(gunzipSync(buf).toString("utf8")) as WorkerState;

function fromTmp(season: number): WorkerState | null {
  try {
    return decode(readFileSync(tmpPath(season)));
  } catch {
    return null;
  }
}

export async function loadWorkerState(
  season: number,
  opts: { target?: SyncTarget | null; staleIfSavedBefore?: number } = {},
): Promise<WorkerState | null> {
  const freshEnough = (s: WorkerState | null): WorkerState | null =>
    s && !(opts.staleIfSavedBefore && s.savedAt < opts.staleIfSavedBefore) ? s : null;

  const mem = freshEnough(cache.get(season) ?? null);
  if (mem) return mem;
  const tmp = freshEnough(fromTmp(season));
  if (tmp) {
    cache.set(season, tmp);
    return tmp;
  }

  if (opts.target) {
    try {
      const ref = await opts.target.client.query(api.sync.state.workerStateUrl, {
        secret: opts.target.secret,
        season,
      });
      if (ref?.url) {
        const res = await fetch(ref.url, { cache: "no-store" });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const state = decode(buf);
          cache.set(season, state);
          try {
            writeFileSync(tmpPath(season), buf);
          } catch {
            /* read-only fs — memory cache still holds it */
          }
          return state;
        }
      }
    } catch {
      /* Convex unreachable — fall through to any stale local copy */
    }
  }

  // A stale local copy beats nothing (the fingerprint diff self-corrects).
  return cache.get(season) ?? fromTmp(season);
}

/** Persist worker state: memory + /tmp always; upload to the target's Convex
 *  file storage when a target is given (the cross-instance source of truth). */
export async function saveWorkerState(
  season: number,
  state: WorkerState,
  target?: SyncTarget | null,
): Promise<void> {
  cache.set(season, state);
  const buf = gzipSync(Buffer.from(JSON.stringify(state)), { level: 6 });
  try {
    writeFileSync(tmpPath(season), buf);
  } catch {
    /* read-only fs is fine */
  }
  if (!target) return;

  const uploadUrl: string = await target.client.mutation(api.sync.state.workerStateUploadUrl, {
    secret: target.secret,
  });
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/gzip" },
    body: new Blob([new Uint8Array(buf)]),
  });
  if (!res.ok) throw new Error(`worker-state upload failed: HTTP ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: string };
  await target.client.mutation(api.sync.state.commitWorkerState, {
    secret: target.secret,
    season,
    storageId: storageId as never,
    savedAt: state.savedAt,
  });
}
