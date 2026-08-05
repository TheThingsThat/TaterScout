/**
 * Seed (or re-sync) the Convex serving layer from the local computed datasets.
 *
 *   npx tsx scripts/seed-convex.ts 2025
 *
 * Reads src/data/{rankings,trajectories,event-stats}-{season}.json, shapes them
 * into Convex docs, and writes ONLY rows whose fingerprint changed since the
 * last run — so a second run is a no-op, proving the diff path. Uses the same
 * secret-guarded mutations + push module as the runtime sync worker. When the
 * local raw crawl cache exists (scripts/build-epa.ts), the full worker state
 * (raw + fingerprints, gzipped) is persisted so the runtime worker adopts it.
 * Env: NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) + SYNC_SECRET, read from
 * .env.local when not already in the environment.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { api } from "../convex/_generated/api";
import { buildSiteDocs, diffFingerprints } from "../src/lib/data/fingerprint.ts";
import { pushSiteDocs, syncTargetFromEnv } from "../src/lib/data/syncPush.ts";
import { loadWorkerState, saveWorkerState } from "../src/lib/data/workerState.ts";
import type { ComputedData } from "../src/lib/data/types.ts";

const SEASON = Number(process.argv[2]) || 2025;

// Minimal .env.local loader (tsx scripts don't get Next's env handling).
function loadEnvLocal(): void {
  const p = path.join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

const dataDir = process.env.VIBESCOUT_DATA_DIR || path.join(process.cwd(), "src", "data");

async function main() {
  // Resolved inside main(): a top-level await breaks tsx's CJS transform.
  const target = await syncTargetFromEnv(SEASON);
  if (!target) {
    console.error("[seed-convex] NEXT_PUBLIC_CONVEX_URL and SYNC_SECRET are required.");
    process.exit(1);
  }
  const data: ComputedData = {
    rankings: JSON.parse(readFileSync(path.join(dataDir, `rankings-${SEASON}.json`), "utf8")),
    trajectories: JSON.parse(readFileSync(path.join(dataDir, `trajectories-${SEASON}.json`), "utf8")),
    eventStats: JSON.parse(readFileSync(path.join(dataDir, `event-stats-${SEASON}.json`), "utf8")),
  };
  const { docs, fingerprints } = buildSiteDocs(data);

  // Previous fingerprints come from the worker state (or legacy raw adoption).
  const prevState = await loadWorkerState(SEASON);
  const diff = diffFingerprints(fingerprints, prevState?.fingerprints ?? null, "full");
  console.log(
    `[seed-convex] to write: meta=${diff.meta} teams=${diff.teams.length} traj=${diff.trajectories.length} eventStats=${diff.eventStats.length} events=${diff.events.length}`,
  );

  const wrote = await pushSiteDocs(target, docs, diff);
  const changed = wrote.calls > 0;
  if (changed) {
    await target.client.mutation(api.sync.state.finish, {
      secret: target.secret,
      season: SEASON,
      nextCheckAt: Date.now(),
      changed: true,
      wide: false,
      rankSynced: true,
    });
  }

  // Persist worker state so the runtime worker starts from these fingerprints
  // (with the raw events when the local crawl cache is available).
  await saveWorkerState(SEASON, {
    savedAt: Date.now(),
    events: prevState?.events ?? [],
    fingerprints,
  });
  console.log(
    `[seed-convex] done: ${wrote.calls} mutation calls (${wrote.teams} teams, ${wrote.trajectories} traj, ${wrote.eventStats} eventStats, ${wrote.events} events); worker state saved (${prevState?.events.length ?? 0} raw events)`,
  );
}

main().catch((e) => {
  console.error("\n[seed-convex] failed:", (e as Error).message);
  process.exit(1);
});
