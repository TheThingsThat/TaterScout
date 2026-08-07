// Batched, diffed push of the computed season docs into Convex — shared by the
// runtime sync worker and scripts/seed-convex.ts so both exercise the same
// write path. Sends ONLY the keys listed in `diff` (fingerprint output).
//
// convex/browser is imported LAZILY: this module sits on the autoRefresh chain
// that every page pulls in, and the mutation client (with its Node-entry
// imports) must not land in page bundles — only the post-response sync needs it.
import { api } from "@convex/_generated/api";
import type { ConvexHttpClient } from "convex/browser";
import type { SiteDocs, Fingerprints, diffFingerprints } from "./fingerprint";

export interface SyncTarget {
  client: ConvexHttpClient;
  secret: string;
  season: number;
}

// One client per URL per instance — syncTargetFromEnv runs on every heartbeat
// tick, and rebuilding the client (plus re-resolving the dynamic import) each
// time was pure overhead.
let cachedClient: { url: string; client: ConvexHttpClient } | null = null;

export async function syncTargetFromEnv(season: number): Promise<SyncTarget | null> {
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.SYNC_SECRET;
  if (!url || !secret) return null;
  if (cachedClient?.url !== url) {
    const { ConvexHttpClient } = await import("convex/browser");
    cachedClient = { url, client: new ConvexHttpClient(url) };
  }
  return { client: cachedClient.client, secret, season };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface PushCounts {
  teams: number;
  trajectories: number;
  eventStats: number;
  events: number;
  meta: boolean;
  deletions: number;
  calls: number;
}

/** Push the diffed docs. On a failed batch the caller should invalidate those
 *  fingerprint keys (we throw with the failed keys attached) so the next sync
 *  rewrites them — self-healing. */
export async function pushSiteDocs(
  target: SyncTarget,
  docs: SiteDocs,
  diff: ReturnType<typeof diffFingerprints>,
): Promise<PushCounts> {
  const { client, secret, season } = target;
  const counts: PushCounts = {
    teams: 0,
    trajectories: 0,
    eventStats: 0,
    events: 0,
    meta: false,
    deletions: 0,
    calls: 0,
  };

  const teamSet = new Set(diff.teams);
  const trajSet = new Set(diff.trajectories);
  const statSet = new Set(diff.eventStats);
  const eventSet = new Set(diff.events);

  const teamDocs = docs.teams.filter((t) => teamSet.has(t.numberStr));
  const trajDocs = docs.trajectories.filter((t) => trajSet.has(String(t.team)));
  const statDocs = docs.eventStats.filter((e) => statSet.has(e.code));
  const eventDocs = docs.events.filter((e) => eventSet.has(e.code));

  for (const batch of chunk(teamDocs, 400)) {
    await client.mutation(api.sync.write.upsertTeams, { secret, season, rows: batch });
    counts.teams += batch.length;
    counts.calls++;
  }
  for (const batch of chunk(trajDocs, 150)) {
    await client.mutation(api.sync.write.upsertTrajectories, { secret, season, rows: batch });
    counts.trajectories += batch.length;
    counts.calls++;
  }
  for (const batch of chunk(statDocs, 300)) {
    await client.mutation(api.sync.write.upsertEventStats, { secret, season, rows: batch });
    counts.eventStats += batch.length;
    counts.calls++;
  }
  for (const batch of chunk(eventDocs, 400)) {
    await client.mutation(api.sync.write.upsertEvents, { secret, season, rows: batch });
    counts.events += batch.length;
    counts.calls++;
  }
  if (diff.meta) {
    await client.mutation(api.sync.write.putMeta, { secret, season, meta: docs.meta });
    counts.meta = true;
    counts.calls++;
  }
  if (diff.removedTeams.length) {
    for (const batch of chunk(diff.removedTeams.map(Number), 400)) {
      await client.mutation(api.sync.write.deleteKeys, { secret, season, kind: "teams", teams: batch });
      await client.mutation(api.sync.write.deleteKeys, { secret, season, kind: "trajectories", teams: batch });
      counts.deletions += batch.length;
      counts.calls += 2;
    }
  }
  if (diff.removedEvents.length) {
    for (const batch of chunk(diff.removedEvents, 400)) {
      await client.mutation(api.sync.write.deleteKeys, { secret, season, kind: "events", codes: batch });
      await client.mutation(api.sync.write.deleteKeys, { secret, season, kind: "eventStats", codes: batch });
      counts.deletions += batch.length;
      counts.calls += 2;
    }
  }
  return counts;
}

/** Drop pushed-but-maybe-failed keys from a fingerprint map so the next sync
 *  retries them (used when pushSiteDocs throws partway). */
export function invalidateKeys(
  fp: Fingerprints,
  diff: ReturnType<typeof diffFingerprints>,
): Fingerprints {
  const out: Fingerprints = {
    meta: diff.meta ? "" : fp.meta,
    teams: { ...fp.teams },
    trajectories: { ...fp.trajectories },
    eventStats: { ...fp.eventStats },
    events: { ...fp.events },
  };
  for (const k of diff.teams) delete out.teams[k];
  for (const k of diff.trajectories) delete out.trajectories[k];
  for (const k of diff.eventStats) delete out.eventStats[k];
  for (const k of diff.events) delete out.events[k];
  return out;
}
