/**
 * Sanity + real-event check for Strength of Schedule (src/lib/predict/sos.ts).
 *
 * Usage: npx tsx scripts/verify-sos.ts [season] [eventCode]
 *
 * Unit sanity: percentiles in [0,1]; a random "actual" schedule → mean composite
 * ≈ 0.5; Δ EPA closed form matches an independent recompute; negating all EPAs
 * flips the Δ EPA percentile (easy↔hard).
 * Real-event: FTCCMP1GOOD — pre-event EPA, real quals schedule; a strong team
 * that seeded poorly should show a HARD schedule (high composite), and vice versa.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeSos } from "../src/lib/predict/sos.ts";
import { mulberry32 } from "../src/lib/predict/simulate.ts";
import type { SchedMatchIdx } from "../src/lib/predict/schedule.ts";
import { generateSchedule } from "../src/lib/predict/schedule.ts";
import type { SimModel } from "../src/lib/predict/model.ts";

const ENDPOINT = "https://api.ftcscout.org/graphql";
const SEASON = Number(process.argv[2]) || 2025;
const CODE = process.argv[3] || "FTCCMP1GOOD";
const __dirname = dirname(fileURLToPath(import.meta.url));

const rankFile = JSON.parse(
  readFileSync(resolve(__dirname, `../src/data/rankings-${SEASON}.json`), "utf8"),
);
const MODEL: SimModel = rankFile.simModel;
const evStats = JSON.parse(
  readFileSync(resolve(__dirname, `../src/data/event-stats-${SEASON}.json`), "utf8"),
) as { events: Record<string, Record<string, (number | null)[]>> };
const rawPath = `/tmp/vibescout-raw-${SEASON}-v4.json`;
const raw = JSON.parse(readFileSync(rawPath, "utf8")) as {
  code: string;
  matches: { level: string; red: number[]; blue: number[] }[];
  teams: { num: number }[];
}[];

const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------------- Unit sanity ----------------
function unit() {
  const n = 40;
  const rng = mulberry32(7);
  const teams = Array.from({ length: n }, (_, i) => 1000 + i);
  const epaArr = Array.from({ length: n }, () => 120 + (rng() - 0.5) * 120);
  const epaOf = (i: number) => epaArr[i];
  const matchesPerTeam = 8;
  const actual = generateSchedule(n, matchesPerTeam, mulberry32(99));

  const res = computeSos({ teams, epaOf, actualSchedule: actual, model: MODEL, matchesPerTeam, iters: 1000, seed: 1 });

  const pctiles = res.teams.flatMap((t) => [t.rpPctile, t.rankPctile, t.epaPctile, t.composite]);
  const inRange = pctiles.every((p) => p >= 0 && p <= 1);
  const meanComposite = res.teams.reduce((s, t) => s + t.composite, 0) / res.teams.length;

  // Independent Δ EPA recompute for one team.
  const mean = epaArr.reduce((a, b) => a + b, 0) / n;
  const t0 = res.teams.find((t) => t.number === 1000)!;
  let pSum = 0, pCnt = 0, oSum = 0, oCnt = 0;
  for (const [a, b, c, d] of actual) {
    const ally = [a, b], opp = [c, d];
    for (const pair of [[ally, opp], [opp, ally]] as [number[], number[]][]) {
      const [al, op] = pair;
      if (al.includes(0)) {
        const partner = al.find((x) => x !== 0)!;
        pSum += epaArr[partner]; pCnt++;
        oSum += epaArr[op[0]] + epaArr[op[1]]; oCnt += 2;
      }
    }
  }
  const bruteDeltaEpa = mean + pSum / pCnt - 2 * (oSum / oCnt);

  console.log("── Unit sanity ──");
  console.log(`  percentiles all in [0,1]:        ${inRange ? "✓" : "✗"}`);
  console.log(`  mean composite ≈ 0.5:            ${r2(meanComposite)} ${Math.abs(meanComposite - 0.5) < 0.05 ? "✓" : "✗"}`);
  console.log(`  Δ EPA closed form = brute force: engine ${r2(t0.deltaEpa)} vs ${r2(bruteDeltaEpa)} ${Math.abs(t0.deltaEpa - bruteDeltaEpa) < 0.01 ? "✓" : "✗"}`);

  // Flip test: negate EPAs → Δ EPA percentile should flip (easy↔hard).
  const flip = computeSos({ teams, epaOf: (i) => -epaArr[i], actualSchedule: actual, model: MODEL, matchesPerTeam, iters: 200, seed: 1 });
  const fById = new Map(flip.teams.map((t) => [t.number, t]));
  const flips = res.teams.map((t) => t.epaPctile + (fById.get(t.number)?.epaPctile ?? 0));
  const flipOk = flips.every((s) => Math.abs(s - 1) < 1e-6);
  console.log(`  negating EPA flips Δ EPA pctile:  ${flipOk ? "✓" : "✗"}\n`);
}

// ---------------- Real event ----------------
async function gql<T>(q: string, v: Record<string, unknown>): Promise<T> {
  const r = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables: v }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
  return j.data as T;
}

async function realEvent() {
  const e = raw.find((x) => x.code === CODE);
  if (!e) return console.log(`real event ${CODE}: not in raw cache`);
  const snap = evStats.events[CODE];
  if (!snap) return console.log(`real event ${CODE}: no snapshot`);

  const teamNums = e.teams.map((t) => t.num);
  const idxOf = new Map(teamNums.map((nn, i) => [nn, i]));
  const preEpa = (nn: number) => (snap[String(nn)]?.[0] as number | null) ?? rankFile.teams[String(nn)]?.epa ?? 0;
  const epaOf = (i: number) => preEpa(teamNums[i]);

  const sched: SchedMatchIdx[] = [];
  for (const m of e.matches) {
    if (m.level !== "Quals" || m.red.length !== 2 || m.blue.length !== 2) continue;
    const idx = [...m.red, ...m.blue].map((t) => idxOf.get(t));
    if (idx.every((x) => x != null)) sched.push(idx as SchedMatchIdx);
  }
  const matchesPerTeam = Math.round((sched.length * 4) / teamNums.length);

  const res = computeSos({ teams: teamNums, epaOf, actualSchedule: sched, model: MODEL, matchesPerTeam, seed: 1 });

  // Real ranks for corroboration.
  const { eventByCode } = await gql<{ eventByCode: { teams: { teamNumber: number; stats: { rank: number } | null }[] } | null }>(
    `query($s:Int!,$c:String!){ eventByCode(season:$s,code:$c){ teams { teamNumber stats { ... on TeamEventStats${SEASON} { rank } } } } }`,
    { s: SEASON, c: CODE },
  );
  const realRank = new Map((eventByCode?.teams ?? []).filter((t) => t.stats).map((t) => [t.teamNumber, t.stats!.rank]));
  // EPA rank entering the event (pre-event EPA order).
  const epaOrder = [...teamNums].sort((a, b) => preEpa(b) - preEpa(a));
  const epaRank = new Map(epaOrder.map((t, i) => [t, i + 1]));

  const row = (t: (typeof res.teams)[number]) =>
    `  #${String(t.number).padEnd(6)} comp ${t.composite.toFixed(2)}  (RP ${t.rpPctile.toFixed(2)} Rank ${t.rankPctile.toFixed(2)} EPA ${t.epaPctile.toFixed(2)})  ΔEPA ${t.deltaEpa.toFixed(1).padStart(6)}  seed ${realRank.get(t.number) ?? "?"} / epaRk ${epaRank.get(t.number) ?? "?"}`;

  console.log(`── Real event ${CODE} (pre-event EPA, ${res.iters} random schedules, m/team=${matchesPerTeam}) ──`);
  console.log("  Hardest schedules:");
  res.teams.slice(0, 5).forEach((t) => console.log(row(t)));
  console.log("  Easiest schedules:");
  res.teams.slice(-5).forEach((t) => console.log(row(t)));
  const t26000 = res.teams.find((t) => t.number === 26000);
  if (t26000) {
    console.log("\n  #26000 (EPA-strong, seeded poorly → expect HARD):");
    console.log(row(t26000) + `   composite percentile rank: ${res.teams.indexOf(t26000) + 1}/${res.teams.length}`);
  }
}

async function main() {
  console.log(`[sos-verify] season ${SEASON} · marginSd ${MODEL.marginSd}\n`);
  unit();
  await realEvent();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
