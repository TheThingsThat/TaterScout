/**
 * Rebuild a season's datasets from the raw match history the TARGET deployment's
 * sync worker saved (Convex file storage), with today's compute code, and write
 * the JSONs seed-convex.ts pushes. For a season the worker synced past any local
 * crawl — e.g. 2025, synced in production until its rollover — this is the only
 * complete copy; reseeding from an older local crawl would roll it back.
 *
 *   SYNC_SECRET=… CONVEX_URL=… VIBESCOUT_DATA_DIR=data/rebuilt \
 *     npx tsx scripts/rebuild-from-deployment.ts 2025
 *
 * Reads the deployment's file directly, never the /tmp or memory caches (a
 * static seed leaves an empty cache behind). Read-only against the deployment.
 */
import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { api } from "../convex/_generated/api";
import { syncTargetFromEnv } from "../src/lib/data/syncPush.ts";
import { computeSeasonData } from "../src/lib/data/compute.ts";
import type { RawEvent } from "../src/lib/data/types.ts";

const SEASON = Number(process.argv[2]);
const dataDir = process.env.VIBESCOUT_DATA_DIR || path.join(process.cwd(), "data", "rebuilt");

// Same minimal .env.local loader as seed-convex.ts (process env wins).
function loadEnvLocal(): void {
  const p = path.join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

async function main() {
  if (!Number.isInteger(SEASON)) throw new Error("Usage: rebuild-from-deployment.ts <season>");
  const target = await syncTargetFromEnv(SEASON);
  if (!target) throw new Error("CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) and SYNC_SECRET are required.");

  const ref = await target.client.query(api.sync.state.workerStateUrl, { secret: target.secret, season: SEASON });
  if (!ref?.url) throw new Error(`The deployment has no saved worker state for ${SEASON}.`);
  const res = await fetch(ref.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const state = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")) as { savedAt: number; events: RawEvent[] };
  const matches = state.events.reduce((s, e) => s + e.matches.length, 0);
  console.log(`[rebuild] ${target.client.url} · ${SEASON}: worker state from ${new Date(state.savedAt).toISOString()}, ${state.events.length} events, ${matches} matches`);

  const computed = computeSeasonData(SEASON, state.events);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, `rankings-${SEASON}.json`), JSON.stringify(computed.rankings));
  writeFileSync(path.join(dataDir, `trajectories-${SEASON}.json`), JSON.stringify(computed.trajectories));
  writeFileSync(path.join(dataDir, `event-stats-${SEASON}.json`), JSON.stringify(computed.eventStats));
  console.log(`[rebuild] wrote ${dataDir}: ${computed.rankings.teamCount} teams, ${computed.rankings.matchCount} matches`);
}

main().catch((e) => {
  console.error("[rebuild] failed:", (e as Error).message);
  process.exit(1);
});
