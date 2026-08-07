/**
 * Full season precompute: crawl all FIRST API events, compute EPA/OPR/sim-model/
 * trajectories/snapshots, and write the dataset JSONs seed-convex.ts pushes.
 *
 * Usage:  npx tsx scripts/build-epa.ts [season] [--refetch]
 *
 * Shares its crawl + compute with the runtime refresh worker (src/lib/data/*).
 * The raw crawl rides the local worker-state cache (/tmp, gzipped) so a
 * recompute skips the (rate-limited) crawl; pass --refetch to force one.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fetchAllEvents } from "../src/lib/data/crawl.ts";
import { computeSeasonData } from "../src/lib/data/compute.ts";
import { loadWorkerState, saveWorkerState } from "../src/lib/data/workerState.ts";
import type { RawEvent } from "../src/lib/data/types.ts";

const SEASON = Number(process.argv[2]) || 2025;
const REFETCH = process.argv.includes("--refetch");

const dataDir = process.env.VIBESCOUT_DATA_DIR || path.join(process.cwd(), "src", "data");

async function main() {
  let events: RawEvent[] | null = null;
  if (!REFETCH) {
    const state = await loadWorkerState(SEASON);
    if (state && state.events.length > 0) events = state.events;
  }
  if (events) {
    console.log(`[build] using cached raw (${events.length} events)`);
  } else {
    console.log(`[build] crawling season ${SEASON}…`);
    const t0 = Date.now();
    events = await fetchAllEvents(SEASON, (done, total) => {
      if (done % 100 === 0 || done === total)
        console.log(`[build] ${done}/${total} events · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    });
    console.log(`[build] crawled ${events.length} events`);
  }

  const matchCount = events.reduce((s, e) => s + e.matches.length, 0);
  console.log(`[build] computing over ${matchCount} matches…`);
  const computed = computeSeasonData(SEASON, events);

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, `rankings-${SEASON}.json`), JSON.stringify(computed.rankings));
  writeFileSync(
    path.join(dataDir, `trajectories-${SEASON}.json`),
    JSON.stringify(computed.trajectories),
  );
  writeFileSync(path.join(dataDir, `event-stats-${SEASON}.json`), JSON.stringify(computed.eventStats));

  // Cache the crawl locally; fingerprints are left untouched (null forces the
  // next seed-convex diff against the target's real state, not a guess).
  const prev = await loadWorkerState(SEASON);
  await saveWorkerState(SEASON, {
    savedAt: Date.now(),
    events,
    fingerprints: prev?.fingerprints ?? null,
  });

  const rk = computed.rankings;
  console.log(
    `[build] wrote rankings (${rk.teamCount} teams, ${rk.regions.length} regions), trajectories, event-stats + worker-state cache`,
  );
  console.log(
    `[build] sim model: scoreMean ${rk.simModel?.scoreMean} scoreSd ${rk.simModel?.scoreSd} marginSd ${rk.simModel?.marginSd}`,
  );
  const top = Object.entries(rk.teams)
    .filter(([, r]) => r.epa != null)
    .sort((a, b) => (b[1].epa as number) - (a[1].epa as number))
    .slice(0, 8);
  console.log("[build] top 8 by EPA:");
  for (const [num, r] of top)
    console.log(`  #${num.padEnd(6)} EPA ${r.epa}  OPRnp ${r.oprNp}  [${r.region}]`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
