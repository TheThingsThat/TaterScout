// Strength of Schedule (SoS) — adapts Statbotics' three EPA-based SoS metrics
// (statbotics.io/blog/sos) to FTC. SoS measures how lucky/unlucky a team's
// QUAL-SCHEDULE DRAW was, by comparing its actual schedule against a
// distribution of random balanced schedules. It is a standalone diagnostic: it
// does NOT feed into EPA or the match simulator.
//
// All three metrics are percentiles oriented so HIGHER = HARDER schedule.
//
// FTC adaptations (vs Statbotics' FRC 3v3):
//   • 2v2 → Δ EPA uses 1 partner + 2 opponents, variance 3σ²/n (not 2/3 & 5).
//   • Random schedules come from our generateSchedule (FTC 2v2), not Cheesy Arena.
//   • Expected RP is computed analytically from the calibrated win/RP model
//     (winRp + bonus logistics), cheap enough to run on-demand.
import { winProb, sigmoid, normCdf, type SimModel } from "./model";
import { generateSchedule, type SchedMatchIdx } from "./schedule";
import { mulberry32 } from "./simulate";

export interface SosInput {
  teams: number[]; // team numbers in a stable order
  epaOf: (idx: number) => number; // EPA by team index (pre- or post-event)
  actualSchedule: SchedMatchIdx[]; // real quals, indices into teams[]
  model: SimModel;
  matchesPerTeam: number;
  iters?: number; // random schedules to sample
  seed?: number;
}

export interface TeamSos {
  number: number;
  deltaRp: number; // actual expected RP − random-schedule average (negative = harder)
  rpPctile: number; // 0..1, higher = harder
  deltaRank: number; // actual expected seed − random average (positive = harder)
  rankPctile: number; // higher = harder
  deltaEpa: number; // headwind/tailwind in points (positive = easier)
  epaPctile: number; // higher = harder
  composite: number; // mean of the three percentiles; higher = harder
  avgPartnerEpa: number;
  avgOppEpa: number;
}

export interface SosResult {
  teams: TeamSos[]; // sorted hardest → easiest
  iters: number;
}

/** Analytic expected ranking points per team for one schedule. */
function expectedRpPerTeam(
  schedule: SchedMatchIdx[],
  epa: Float64Array,
  model: SimModel,
  teamCount: number,
): Float64Array {
  const out = new Float64Array(teamCount);
  const ms = model.marginSd;
  const cats = model.rp.categories;
  const winRp = model.rp.winRp;
  for (const [r0, r1, b0, b1] of schedule) {
    if (r0 == null || r1 == null || b0 == null || b1 == null) continue;
    const redEpa = epa[r0] + epa[r1];
    const blueEpa = epa[b0] + epa[b1];
    const pRed = winProb(redEpa, blueEpa, ms);
    let redBonus = 0;
    let blueBonus = 0;
    for (const c of cats) {
      redBonus += sigmoid(c.a + c.b * redEpa);
      blueBonus += sigmoid(c.a + c.b * blueEpa);
    }
    const redRp = winRp * pRed + redBonus;
    const blueRp = winRp * (1 - pRed) + blueBonus;
    out[r0] += redRp;
    out[r1] += redRp;
    out[b0] += blueRp;
    out[b1] += blueRp;
  }
  return out;
}

/** Rank (1 = best) from expected RP, descending. */
function ranksFromRp(rp: Float64Array): Float64Array {
  const n = rp.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rp[b] - rp[a]);
  const rank = new Float64Array(n);
  order.forEach((idx, pos) => (rank[idx] = pos + 1));
  return rank;
}

export function computeSos(input: SosInput): SosResult {
  const { teams, actualSchedule, model, matchesPerTeam } = input;
  const n = teams.length;
  const iters = input.iters ?? (n > 60 ? 500 : 1000);

  const epa = new Float64Array(n);
  for (let i = 0; i < n; i++) epa[i] = input.epaOf(i);

  if (n < 4 || actualSchedule.length === 0) {
    return { teams: [], iters: 0 };
  }

  // --- Δ EPA (closed form) + actual partner/opponent stats ---
  const partnerSum = new Float64Array(n);
  const partnerCnt = new Int32Array(n);
  const oppSum = new Float64Array(n);
  const oppCnt = new Int32Array(n);
  const matchCnt = new Int32Array(n); // matches each team plays in the ACTUAL schedule
  for (const [r0, r1, b0, b1] of actualSchedule) {
    if (r0 == null || r1 == null || b0 == null || b1 == null) continue;
    // Red: partner is the other red; opponents are both blues.
    partnerSum[r0] += epa[r1]; partnerCnt[r0]++; oppSum[r0] += epa[b0] + epa[b1]; oppCnt[r0] += 2; matchCnt[r0]++;
    partnerSum[r1] += epa[r0]; partnerCnt[r1]++; oppSum[r1] += epa[b0] + epa[b1]; oppCnt[r1] += 2; matchCnt[r1]++;
    // Blue: partner is the other blue; opponents are both reds.
    partnerSum[b0] += epa[b1]; partnerCnt[b0]++; oppSum[b0] += epa[r0] + epa[r1]; oppCnt[b0] += 2; matchCnt[b0]++;
    partnerSum[b1] += epa[b0]; partnerCnt[b1]++; oppSum[b1] += epa[r0] + epa[r1]; oppCnt[b1] += 2; matchCnt[b1]++;
  }

  // Event EPA spread for the Δ EPA percentile normal approximation.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += epa[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (epa[i] - mean) * (epa[i] - mean);
  variance /= Math.max(1, n - 1);
  const sigma = Math.sqrt(variance);
  // FTC 2v2: Δ EPA ~ N(0, 3σ²/n) — 1 partner + 2 opponents (Statbotics' 3v3 uses 5).
  const sdDelta = (sigma * Math.sqrt(3)) / Math.sqrt(Math.max(1, matchesPerTeam));

  // --- Actual schedule expected RP + rank ---
  const actualRp = expectedRpPerTeam(actualSchedule, epa, model, n);
  const actualRank = ranksFromRp(actualRp);

  // --- Random schedule distribution ---
  const rand = mulberry32(input.seed ?? 0x50505050);
  const randRpSum = new Float64Array(n);
  const randRankSum = new Float64Array(n);
  const rpEasierCnt = new Int32Array(n); // random RP higher than actual (easier)
  const rankEasierCnt = new Int32Array(n); // random rank better (lower) than actual
  for (let it = 0; it < iters; it++) {
    const sched = generateSchedule(n, matchesPerTeam, rand);
    const rp = expectedRpPerTeam(sched, epa, model, n);
    const rank = ranksFromRp(rp);
    for (let i = 0; i < n; i++) {
      randRpSum[i] += rp[i];
      randRankSum[i] += rank[i];
      if (rp[i] > actualRp[i]) rpEasierCnt[i]++;
      if (rank[i] < actualRank[i]) rankEasierCnt[i]++;
    }
  }

  const out: TeamSos[] = [];
  for (let i = 0; i < n; i++) {
    if (matchCnt[i] === 0) continue; // roster team that never played quals
    const avgPartnerEpa = partnerCnt[i] ? partnerSum[i] / partnerCnt[i] : 0;
    const avgOppEpa = oppCnt[i] ? oppSum[i] / oppCnt[i] : 0;
    const deltaEpa = mean + avgPartnerEpa - 2 * avgOppEpa;
    const epaPctile = sdDelta > 0 ? normCdf(-deltaEpa / sdDelta) : 0.5;
    const rpPctile = rpEasierCnt[i] / iters;
    const rankPctile = rankEasierCnt[i] / iters;
    out.push({
      number: teams[i],
      deltaRp: actualRp[i] - randRpSum[i] / iters,
      rpPctile,
      deltaRank: actualRank[i] - randRankSum[i] / iters,
      rankPctile,
      deltaEpa,
      epaPctile,
      composite: (rpPctile + rankPctile + epaPctile) / 3,
      avgPartnerEpa,
      avgOppEpa,
    });
  }
  out.sort((a, b) => b.composite - a.composite); // hardest first
  return { teams: out, iters };
}
