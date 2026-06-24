/**
 * Full season precompute: crawl all FTCScout events, compute EPA/OPR/sim-model/
 * trajectories/snapshots, and write the data files the app reads.
 *
 * Usage:  npx tsx scripts/build-epa.ts [season] [--refetch]
 *
 * Shares its crawl + compute with the runtime refresh route (src/lib/data/*).
 * The raw crawl is cached at /tmp so a recompute skips the (rate-limited) crawl;
 * pass --refetch to force a fresh crawl.
 */
import { existsSync, readFileSync } from "node:fs";
import { fetchAllEvents } from "../src/lib/data/crawl.ts";
import { computeSeasonData } from "../src/lib/data/compute.ts";
import { applyComputed, persist, rawPath } from "../src/lib/data/store.ts";
import type { RawEvent } from "../src/lib/data/types.ts";

const SEASON = Number(process.argv[2]) || 2025;
const REFETCH = process.argv.includes("--refetch");

async function main() {
  const cachePath = rawPath(SEASON);
  let events: RawEvent[];
  if (!REFETCH && existsSync(cachePath)) {
    console.log(`[build] using cached raw ${cachePath}`);
    events = JSON.parse(readFileSync(cachePath, "utf8")) as RawEvent[];
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
  applyComputed(SEASON, events, computed);
  persist(SEASON);

  const rk = computed.rankings;
  console.log(
    `[build] wrote rankings (${rk.teamCount} teams, ${rk.regions.length} regions), trajectories, event-stats, raw cache`,
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
