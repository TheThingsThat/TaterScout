/**
 * Seed Vercel Blob with the CURRENT local datasets (no crawl) — one-time setup.
 *
 *   BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..." npx tsx scripts/seed-blob.ts 2025
 *
 * Uploads the four datasets the app reads so the deployed site (and the refresh
 * button) have data immediately, without re-crawling FTCScout. Without the token
 * it just rewrites the local files (no-op for setup).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { writeDataset } from "../src/lib/data/storage.ts";

const SEASON = Number(process.argv[2]) || 2025;

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.warn(
    "[seed] BLOB_READ_WRITE_TOKEN not set — this will write LOCAL files, not Blob.\n" +
      "       Set it (from your Vercel Blob store) to seed production.",
  );
}

const dataDir = process.env.VIBESCOUT_DATA_DIR || path.join(process.cwd(), "src", "data");
const sources: [string, string][] = [
  [`rankings-${SEASON}`, path.join(dataDir, `rankings-${SEASON}.json`)],
  [`trajectories-${SEASON}`, path.join(dataDir, `trajectories-${SEASON}.json`)],
  [`event-stats-${SEASON}`, path.join(dataDir, `event-stats-${SEASON}.json`)],
  [`raw-${SEASON}`, `/tmp/vibescout-raw-${SEASON}-v6.json`],
];

async function main() {
  for (const [name, file] of sources) {
    if (!existsSync(file)) {
      console.warn(`[seed] skip ${name}: ${file} not found`);
      continue;
    }
    const content = readFileSync(file, "utf8");
    await writeDataset(name, content);
    console.log(`[seed] uploaded ${name}  (${(content.length / 1e6).toFixed(2)} MB)`);
  }
  console.log("[seed] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
