/**
 * Accuracy test for the event simulator. For sample finished events at each
 * level, run the Monte-Carlo sim (real qual schedule) and compare to actuals:
 *   - predicted seed (meanSeed) vs real rank: mean |error| + Spearman
 *   - winner: is the top-winPct team on the real winning alliance? + Brier
 *
 * Usage: npx tsx scripts/verify-simulate.ts [season] [eventCode...]
 * Uses PRE-event EPA (each team's rating entering the event) so the backtest is
 * unbiased — no leakage of the event's own results. Falls back to season EPA
 * for any team missing from the snapshot.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateEvent, type SimTeam } from "../src/lib/predict/simulate.ts";
import type { SchedMatchIdx } from "../src/lib/predict/schedule.ts";
import type { SimModel } from "../src/lib/predict/model.ts";

const ENDPOINT = "https://api.ftcscout.org/graphql";
const SEASON = Number(process.argv[2]) || 2025;
const __dirname = dirname(fileURLToPath(import.meta.url));

// level → representative finished event
const SAMPLES: [string, string][] =
  process.argv.length > 3
    ? process.argv.slice(3).map((c) => ["Event", c] as [string, string])
    : [
        ["LeagueMeet", "CAABAHM2"],
        ["Qualifier", "USAZTUQ"],
        ["Championship", "AUCMP"],
        ["Worlds Div", "FTCCMP1ROSS"],
      ];

const rankFile = JSON.parse(
  readFileSync(resolve(__dirname, `../src/data/rankings-${SEASON}.json`), "utf8"),
);
const SIM_MODEL: SimModel = rankFile.simModel;
const seasonEpaOf = (t: number): number | undefined =>
  rankFile.teams[String(t)]?.epa ?? undefined;

// Per-event snapshot: row[0] = pre-event total EPA (rating entering the event).
const evStatsFile = JSON.parse(
  readFileSync(resolve(__dirname, `../src/data/event-stats-${SEASON}.json`), "utf8"),
) as { events: Record<string, Record<string, (number | null)[]>> };
const preEpaOf = (code: string, t: number): number =>
  evStatsFile.events[code]?.[String(t)]?.[0] ?? seasonEpaOf(t) ?? 0;

async function gql<T>(q: string, v: Record<string, unknown>): Promise<T> {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, variables: v }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
  return j.data as T;
}

interface ApiMatch {
  matchNum: number;
  tournamentLevel: string;
  series: number;
  hasBeenPlayed: boolean;
  actualStartTime: string | null;
  teams: { teamNumber: number; alliance: string; allianceRole: string | null; onField: boolean }[];
  scores: { red?: { totalPoints: number }; blue?: { totalPoints: number } } | null;
}

function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((_, i) => i).sort((p, q) => xs[p] - xs[q]);
    const r = new Array(xs.length);
    idx.forEach((i, k) => (r[i] = k));
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

async function run(level: string, code: string) {
  const { eventByCode: e } = await gql<{
    eventByCode: {
      teams: { teamNumber: number; stats: { rank: number } | null }[];
      matches: ApiMatch[];
    } | null;
  }>(
    `query($s:Int!,$c:String!){ eventByCode(season:$s,code:$c){
      teams { teamNumber stats { ... on TeamEventStats${SEASON} { rank } } }
      matches { matchNum tournamentLevel series hasBeenPlayed actualStartTime
        teams { teamNumber alliance allianceRole onField }
        scores { ... on MatchScores${SEASON} { red { totalPoints } blue { totalPoints } } } } } }`,
    { s: SEASON, c: code },
  );
  if (!e) return console.log(`${level} ${code}: not found`);

  const teamNums = e.teams.map((t) => t.teamNumber);
  const idxOf = new Map(teamNums.map((n, i) => [n, i]));
  const simTeams: SimTeam[] = teamNums.map((n) => ({ number: n, epa: preEpaOf(code, n) }));

  // Real qual schedule → local indices.
  const realSchedule: SchedMatchIdx[] = [];
  let matchesPlayed = 0;
  for (const m of e.matches) {
    if (m.tournamentLevel !== "Quals") continue;
    const red = m.teams.filter((t) => t.alliance === "Red").map((t) => idxOf.get(t.teamNumber)!);
    const blue = m.teams.filter((t) => t.alliance === "Blue").map((t) => idxOf.get(t.teamNumber)!);
    if (red.length === 2 && blue.length === 2 && [...red, ...blue].every((x) => x != null)) {
      realSchedule.push([red[0], red[1], blue[0], blue[1]]);
      matchesPlayed++;
    }
  }
  const matchesPerTeam = Math.round((matchesPlayed * 4) / teamNums.length);

  // Alliance structure from real playoff data.
  const po = e.matches.filter((m) => m.tournamentLevel !== "Quals");
  const captains = new Set(po.flatMap((m) => m.teams).filter((t) => t.allianceRole === "Captain").map((t) => t.teamNumber));
  const hasSecond = po.some((m) => m.teams.some((t) => t.allianceRole === "SecondPick"));
  const K = captains.size || undefined;
  const S = hasSecond ? 3 : 2;

  // Real winner: winning alliance of the last played playoff match.
  const played = po.filter((m) => m.hasBeenPlayed && m.scores?.red && m.scores?.blue);
  played.sort((a, b) => Date.parse(a.actualStartTime ?? "") - Date.parse(b.actualStartTime ?? ""));
  const realWinners = new Set<number>();
  if (played.length) {
    const f = played[played.length - 1];
    const win = (f.scores!.red!.totalPoints >= f.scores!.blue!.totalPoints) ? "Red" : "Blue";
    f.teams.filter((t) => t.alliance === win).forEach((t) => realWinners.add(t.teamNumber));
  }

  const res = simulateEvent({
    teams: simTeams,
    model: SIM_MODEL,
    matchesPerTeam: matchesPerTeam || 5,
    realSchedule,
    allianceCount: K,
    allianceSize: S,
    iters: 3000,
    seed: 12345,
  });

  // Seed accuracy (teams with a real rank).
  const realRank = new Map(e.teams.filter((t) => t.stats).map((t) => [t.teamNumber, t.stats!.rank]));
  const predBy = new Map(res.teams.map((t) => [t.number, t.meanSeed]));
  const common = teamNums.filter((n) => realRank.has(n));
  const predSeeds = common.map((n) => predBy.get(n)!);
  const realSeeds = common.map((n) => realRank.get(n)!);
  const seedErr = common.reduce((s, n) => s + Math.abs(predBy.get(n)! - realRank.get(n)!), 0) / common.length;
  const rho = spearman(predSeeds, realSeeds);

  // Winner: top-winPct team on real winning alliance? + Brier.
  const top = res.teams[0];
  const top1 = realWinners.has(top.number) ? "✓" : "✗";
  const brier =
    res.teams.reduce((s, t) => s + ((t.winPct / 100) - (realWinners.has(t.number) ? 1 : 0)) ** 2, 0) /
    res.teams.length;

  console.log(
    `${level.padEnd(12)} ${code.padEnd(12)} n=${String(teamNums.length).padStart(3)} K×S=${K ?? "?"}×${S} m/team=${matchesPerTeam}\n` +
      `   seed: mean|err| ${seedErr.toFixed(1)} · Spearman ${rho.toFixed(2)}\n` +
      `   winner: top pick #${top.number} (${top.winPct.toFixed(1)}% win) ${top1} on real winning alliance · Brier ${brier.toFixed(4)}`,
  );
}

async function main() {
  console.log(`[sim-verify] season ${SEASON} · marginSd ${SIM_MODEL.marginSd}\n`);
  for (const [level, code] of SAMPLES) {
    try {
      await run(level, code);
    } catch (err) {
      console.log(`${level} ${code}: ${(err as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
