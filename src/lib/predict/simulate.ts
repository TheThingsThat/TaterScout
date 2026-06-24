// Monte-Carlo FTC event simulator. One iteration: simulate quals → tabulate
// RP → seed → alliance selection (softmax over EPA) → double-elimination
// playoffs → winner. Aggregated over many iterations into per-team
// probabilities. Champs run several divisions then a finals bracket.
//
// Adapted from Statbotics' FRC "Simulate Champs"; FTC differences are
// documented in the plan (2v2, 4×2 or 8×3 alliances, top-2-of-roster strength,
// captains = top seeds to approximate universal declining).
import { winProb, sampleRp, type SimModel } from "./model";
import { generateSchedule, type SchedMatchIdx } from "./schedule";

export interface SimTeam {
  number: number;
  epa: number;
}

export interface SimInput {
  teams: SimTeam[];
  model: SimModel;
  matchesPerTeam: number;
  iters: number;
  realSchedule?: SchedMatchIdx[]; // indices into teams[]; single-event real mode
  allianceCount?: number;
  allianceSize?: number;
  divisionCount?: number; // champs: random assignment into this many divisions
  seed?: number;
}

export interface TeamSim {
  number: number;
  winPct: number;
  divWinPct: number | null;
  playoffPct: number;
  captainPct: number;
  meanSeed: number;
  bestSeed: number;
  worstSeed: number;
}

export interface SimResult {
  teams: TeamSim[];
  iters: number;
  allianceCount: number;
  allianceSize: number;
  divisionCount: number | null;
}

// --- RNG (mulberry32) ---
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FTC alliance structure heuristic when no real playoff data is available. */
export function inferStructure(teamCount: number): { K: number; S: number } {
  return teamCount >= 28 ? { K: 8, S: 3 } : { K: 4, S: 2 };
}

function softmaxPick(
  pool: number[], // local member indices still available
  epa: (i: number) => number,
  mult: number,
  rand: () => number,
): number {
  let max = -Infinity;
  for (const i of pool) if (epa(i) > max) max = epa(i);
  let sum = 0;
  const w = pool.map((i) => {
    const e = Math.exp(mult * (epa(i) - max));
    sum += e;
    return e;
  });
  let r = rand() * sum;
  for (let k = 0; k < pool.length; k++) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return pool.length - 1;
}

interface EventOutcome {
  seedOrder: number[]; // member indices, best → worst
  captains: number[];
  rosters: number[][]; // member indices per alliance (captain first)
  playoff: Set<number>;
  winnerRoster: number[];
}

/** Simulate one event among `members` (local indices); epaOf maps member→EPA. */
function simOneEvent(
  members: number[],
  epaOf: (m: number) => number,
  model: SimModel,
  matchesPerTeam: number,
  K: number,
  S: number,
  rand: () => number,
  realSchedule?: SchedMatchIdx[],
): EventOutcome {
  const n = members.length;
  const ms = model.marginSd;
  const rpSum = new Float64Array(n);
  const rpCnt = new Int32Array(n);

  const schedule =
    realSchedule ?? generateSchedule(n, matchesPerTeam, rand);
  for (const [r0, r1, b0, b1] of schedule) {
    if (r0 == null || r1 == null || b0 == null || b1 == null) continue;
    const red = epaOf(members[r0]) + epaOf(members[r1]);
    const blue = epaOf(members[b0]) + epaOf(members[b1]);
    const redWins = rand() < winProb(red, blue, ms) ? 1 : 0;
    const redRp = sampleRp(red, redWins, model, rand);
    const blueRp = sampleRp(blue, 1 - redWins, model, rand);
    rpSum[r0] += redRp; rpSum[r1] += redRp; rpCnt[r0]++; rpCnt[r1]++;
    rpSum[b0] += blueRp; rpSum[b1] += blueRp; rpCnt[b0]++; rpCnt[b1]++;
  }

  // Seed by average RP, ties broken randomly.
  const seedOrder = members
    .map((_, i) => i)
    .map((i) => ({ i, v: (rpCnt[i] ? rpSum[i] / rpCnt[i] : 0) + rand() * 1e-6 }))
    .sort((a, b) => b.v - a.v)
    .map((x) => x.i);

  // Alliance selection: captains = top K seeds; softmax picks from the rest.
  const kk = Math.min(K, Math.floor(n / S));
  const captains = seedOrder.slice(0, kk);
  const rosters: number[][] = captains.map((c) => [c]);
  const pool = seedOrder.slice(kk);
  for (let round = 0; round < S - 1 && pool.length; round++) {
    const order = round % 2 === 0 ? [...rosters.keys()] : [...rosters.keys()].reverse();
    const mult = round === 0 ? 1 / 3 : 1 / 2;
    for (const a of order) {
      if (!pool.length) break;
      const k = softmaxPick(pool, (i) => epaOf(members[i]), mult, rand);
      rosters[a].push(pool[k]);
      pool.splice(k, 1);
    }
  }

  const playoff = new Set<number>();
  for (const r of rosters) for (const m of r) playoff.add(m);

  // Alliance strength = sum of the top-2 EPAs on the roster (2 robots play).
  const strength = rosters.map((r) => {
    const es = r.map((m) => epaOf(members[m])).sort((a, b) => b - a);
    return (es[0] ?? 0) + (es[1] ?? 0);
  });

  const matchAlliance = (a: number, b: number): number =>
    rand() < winProb(strength[a], strength[b], ms) ? a : b;
  const bo3 = (a: number, b: number): number => {
    let wa = 0, wb = 0;
    while (wa < 2 && wb < 2) (matchAlliance(a, b) === a ? wa++ : wb++);
    return wa === 2 ? a : b;
  };

  const winnerIdx =
    rosters.length >= 5 ? doubleElim8(rosters.length, matchAlliance, bo3) : doubleElim(rosters.length, matchAlliance, bo3);

  return {
    seedOrder,
    captains,
    rosters,
    playoff,
    winnerRoster: rosters[winnerIdx] ?? rosters[0] ?? [],
  };
}

/** Double elimination for ≤4 alliances (handles 2/3/4); returns winner index. */
function doubleElim(
  k: number,
  match: (a: number, b: number) => number,
  bo3: (a: number, b: number) => number,
): number {
  if (k <= 1) return 0;
  if (k === 2) return bo3(0, 1);
  // 3–4 alliance double elim, seeds 0..k-1 (0 = top).
  const A = 0, B = 1, C = 2, D = k >= 4 ? 3 : 2;
  const m1w = match(A, D), m1l = m1w === A ? D : A;
  const m2w = match(B, C), m2l = m2w === B ? C : B;
  const m3w = match(m1l, m2l); // losers
  const m4w = match(m1w, m2w), m4l = m4w === m1w ? m2w : m1w; // winners final
  const m5w = match(m4l, m3w); // losers final
  return bo3(m4w, m5w);
}

/** Standard 8-alliance double elimination (FIRST bracket); winner index. */
function doubleElim8(
  k: number,
  match: (a: number, b: number) => number,
  bo3: (a: number, b: number) => number,
): number {
  // Pad to 8 with the available alliances (treat missing as auto-loss highest seeds).
  const s = [0, 1, 2, 3, 4, 5, 6, 7].filter((x) => x < k);
  const m = (a: number, b: number) => {
    if (a >= k) return b;
    if (b >= k) return a;
    return match(a, b);
  };
  const lo = (a: number, b: number, w: number) => (w === a ? b : a);
  void s;
  const m1 = m(0, 7), m2 = m(3, 4), m3 = m(1, 6), m4 = m(2, 5);
  const m5 = m(lo(0, 7, m1), lo(3, 4, m2));
  const m6 = m(lo(1, 6, m3), lo(2, 5, m4));
  const m7 = m(m1, m2);
  const m8 = m(m3, m4);
  const m9 = m(lo(m1, m2, m7), m6);
  const m10 = m(lo(m3, m4, m8), m5);
  const m11 = m(m7, m8); // winners final
  const m12 = m(m9, m10); // losers
  const m13 = m(lo(m7, m8, m11), m12); // losers final
  return bo3(m11, m13);
}

export function simulateEvent(input: SimInput): SimResult {
  const teams = input.teams;
  const n = teams.length;
  const rand = mulberry32(input.seed ?? 0x9e3779b9);
  const { K, S } = {
    K: input.allianceCount ?? inferStructure(n).K,
    S: input.allianceSize ?? inferStructure(n).S,
  };
  const D = input.divisionCount && input.divisionCount > 1 ? input.divisionCount : null;
  const epaOf = (g: number) => teams[g].epa;

  const win = new Float64Array(n);
  const divWin = new Float64Array(n);
  const playoff = new Float64Array(n);
  const captain = new Float64Array(n);
  const seedSum = new Float64Array(n);
  const seeds: number[][] = Array.from({ length: n }, () => []);

  for (let it = 0; it < input.iters; it++) {
    if (D) {
      // Random division assignment, sim each, then a finals bracket of winners.
      const shuffled = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const winnerRosters: number[][] = [];
      const winnerStrength: number[] = [];
      for (let d = 0; d < D; d++) {
        const members = shuffled.filter((_, idx) => idx % D === d);
        const { K: dk, S: ds } = inferStructure(members.length);
        const out = simOneEvent(members, epaOf, input.model, input.matchesPerTeam, dk, ds, rand);
        out.captains.forEach((m) => captain[members[m]]++);
        out.playoff.forEach((m) => playoff[members[m]]++);
        out.seedOrder.forEach((m, rank) => { seedSum[members[m]] += rank + 1; seeds[members[m]].push(rank + 1); });
        const wr = out.winnerRoster.map((m) => members[m]);
        wr.forEach((g) => divWin[g]++);
        winnerRosters.push(wr);
        const es = wr.map(epaOf).sort((a, b) => b - a);
        winnerStrength.push((es[0] ?? 0) + (es[1] ?? 0));
      }
      // Finals: seed division winners by strength, single-elim knockout.
      const champ = knockout(winnerStrength, rand, input.model.marginSd);
      for (const g of winnerRosters[champ] ?? []) win[g]++;
    } else {
      const members = [...Array(n).keys()];
      const out = simOneEvent(members, epaOf, input.model, input.matchesPerTeam, K, S, rand, input.realSchedule);
      out.captains.forEach((m) => captain[m]++);
      out.playoff.forEach((m) => playoff[m]++);
      out.seedOrder.forEach((m, rank) => { seedSum[m] += rank + 1; seeds[m].push(rank + 1); });
      out.winnerRoster.forEach((m) => win[m]++);
    }
  }

  const iters = input.iters;
  const pct = (x: number) => (x / iters) * 100;
  const out: TeamSim[] = teams.map((t, i) => {
    const sorted = seeds[i].sort((a, b) => a - b);
    const at = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
    return {
      number: t.number,
      winPct: pct(win[i]),
      divWinPct: D ? pct(divWin[i]) : null,
      playoffPct: pct(playoff[i]),
      captainPct: pct(captain[i]),
      meanSeed: seedSum[i] / iters,
      bestSeed: at(0.05),
      worstSeed: at(0.95),
    };
  });
  out.sort((a, b) => b.winPct - a.winPct || a.meanSeed - b.meanSeed);
  return { teams: out, iters, allianceCount: K, allianceSize: S, divisionCount: D };
}

/** Seeded single-elimination among alliances given their strengths. */
function knockout(strength: number[], rand: () => number, marginSd: number): number {
  let field = strength.map((_, i) => i).sort((a, b) => strength[b] - strength[a]);
  while (field.length > 1) {
    const next: number[] = [];
    for (let i = 0; i < field.length; i += 2) {
      if (i + 1 >= field.length) { next.push(field[i]); continue; } // bye
      const a = field[i], b = field[i + 1];
      next.push(rand() < winProb(strength[a], strength[b], marginSd) ? a : b);
    }
    field = next;
  }
  return field[0];
}
