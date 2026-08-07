/**
 * Seed (or re-sync) the Convex serving layer from the local computed datasets.
 *
 *   npx tsx scripts/seed-convex.ts 2025
 *
 * Reads src/data/{rankings,trajectories,event-stats}-{season}.json, shapes them
 * into Convex docs, and writes ONLY rows whose fingerprint changed since the
 * last run — so a second run is a no-op, proving the diff path. Uses the same
 * secret-guarded mutations + push module as the runtime sync worker. The full
 * worker state (raw crawl + fingerprints, gzipped) is uploaded to the target's
 * Convex file storage so the deployment's own sync worker can bootstrap.
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
// Worker state records the fingerprints of the last push, not which deployment
// received it — so seeding a SECOND deployment (prod) would diff against the
// first one's state and write almost nothing. --full ignores it and writes every
// row, which is what a fresh deployment needs.
const FULL = process.argv.includes("--full");

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

  // Previous fingerprints come from the worker state (local cache first, then
  // the target's Convex file storage).
  const prevState = await loadWorkerState(SEASON, { target });
  const prevFp = FULL ? null : (prevState?.fingerprints ?? null);
  const diff = diffFingerprints(fingerprints, prevFp, "full");
  console.log(
    `[seed-convex] target ${target.client.url ?? "?"}${FULL ? " (--full: ignoring prior fingerprints)" : ""}`,
  );
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

  // Upload worker state (raw events + these fingerprints) to the TARGET's
  // Convex file storage — this is what lets the deployment's own sync worker
  // bootstrap. Skipped when there's no raw crawl locally (run build-epa first).
  if ((prevState?.events.length ?? 0) > 0) {
    await saveWorkerState(
      SEASON,
      { savedAt: Date.now(), events: prevState!.events, fingerprints },
      target,
    );
    console.log(
      `[seed-convex] done: ${wrote.calls} mutation calls (${wrote.teams} teams, ${wrote.trajectories} traj, ${wrote.eventStats} eventStats, ${wrote.events} events); worker state uploaded (${prevState!.events.length} raw events)`,
    );
  } else {
    console.warn(
      `[seed-convex] done (${wrote.calls} mutation calls) — but NO raw events cached locally, so worker state was NOT uploaded. Run scripts/build-epa.ts first, then re-run this seed.`,
    );
  }
}

main().catch((e) => {
  console.error("\n[seed-convex] failed:", (e as Error).message);
  process.exit(1);
});
