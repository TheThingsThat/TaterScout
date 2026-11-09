// Win / score / ranking-point model for the event simulator. Adapted from
// Statbotics' FRC "Simulate Champs" notebook to FTC (2v2). All season-specific
// constants (score SD, win-prob scale, RP calibration) are computed from data
// in the precompute (scripts/build-epa.ts) — see computeSimModel there.

export interface RpCategory {
  name: string; // e.g. "bonusRp1"
  a: number; // logistic intercept
  b: number; // logistic slope on alliance EPA-sum
  requires?: number; // index of a category that must be earned first; a, b fit given it
}

export interface RpCalibration {
  categories: RpCategory[]; // P(earned) = sigmoid(a + b·allianceEpaSum)
  winRp: number; // RP for a win; 0 if the season has no win RP
}

export interface SimModel {
  scoreSd: number; // SD of one alliance's no-penalty score
  marginSd: number; // SD of (actual − predicted) match margin; drives win prob
  scoreMean: number; // mean alliance no-penalty score
  rp: RpCalibration;
}

export const DEFAULT_SIM_MODEL: SimModel = {
  scoreSd: 45,
  marginSd: 40,
  scoreMean: 90,
  rp: { categories: [], winRp: 0 },
};

// --- math ---
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

export function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Probability the red alliance beats blue, given each side's summed EPA. */
export function winProb(
  redEpaSum: number,
  blueEpaSum: number,
  marginSd: number,
): number {
  if (marginSd <= 0) return redEpaSum === blueEpaSum ? 0.5 : redEpaSum > blueEpaSum ? 1 : 0;
  return normCdf((redEpaSum - blueEpaSum) / marginSd);
}

/**
 * Ranking points earned by an alliance in one match.
 * `result` is 1 (win) or 0 (loss), as the sim doesn't model ties; `epaSum` is the
 * alliance strength. Bonus RPs are sampled from the calibrated per-category logistics.
 */
export function sampleRp(
  epaSum: number,
  result: number,
  model: SimModel,
  rand: () => number,
): number {
  let rp = model.rp.winRp * result;
  const cats = model.rp.categories;
  let earned = 0; // bitmask of categories hit so far
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    if (c.requires != null && !(earned & (1 << c.requires))) continue;
    if (rand() < sigmoid(c.a + c.b * epaSum)) {
      earned |= 1 << i;
      rp += 1;
    }
  }
  return rp;
}

/** Expected bonus RPs for an alliance, the analytic counterpart of sampleRp. */
export function expectedBonusRp(epaSum: number, model: SimModel): number {
  const ps: number[] = [];
  let total = 0;
  for (const c of model.rp.categories) {
    const p = sigmoid(c.a + c.b * epaSum) * (c.requires != null ? ps[c.requires] : 1);
    ps.push(p);
    total += p;
  }
  return total;
}

// --- calibration (precompute) ---
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function sd(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}

const MIN_LOGISTIC_OUTCOMES = 5; // fewer hits or misses than this can't support a slope
const LOGISTIC_RIDGE = 1e-3; // keeps the slope finite when the classes separate exactly

/** Maximum-likelihood fit of P(y=1) = sigmoid(a + b·x), by Newton's method on a
 *  standardized x. A rare outcome falls back to its smoothed base rate with no slope. */
function fitLogistic(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const hits = ys.reduce((s, y) => s + y, 0);
  const baseRate = Math.log((hits + 0.5) / (n - hits + 0.5));
  const mx = mean(xs);
  const sx = sd(xs, mx);
  if (hits < MIN_LOGISTIC_OUTCOMES || n - hits < MIN_LOGISTIC_OUTCOMES || sx === 0) {
    return { a: baseRate, b: 0 };
  }
  let a = baseRate;
  let b = 0;
  for (let iter = 0; iter < 30; iter++) {
    let ga = 0, gb = -LOGISTIC_RIDGE * b; // gradient
    let haa = 0, hab = 0, hbb = LOGISTIC_RIDGE; // negative Hessian
    for (let i = 0; i < n; i++) {
      const z = (xs[i] - mx) / sx;
      const p = sigmoid(a + b * z);
      const w = p * (1 - p);
      ga += ys[i] - p;
      gb += (ys[i] - p) * z;
      haa += w;
      hab += w * z;
      hbb += w * z * z;
    }
    const det = haa * hbb - hab * hab;
    if (!(det > 0)) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-6) break;
  }
  return Number.isFinite(a) && Number.isFinite(b)
    ? { a: a - (b * mx) / sx, b: b / sx }
    : { a: baseRate, b: 0 };
}

export interface SimMatch {
  redTeams: number[];
  blueTeams: number[];
  redNp: number;
  blueNp: number;
  redRp: number[]; // the game's three bonus RPs, 0/1; empty = unknown
  blueRp: number[];
}

const RP_NAMES = ["bonusRp1", "bonusRp2", "bonusRp3"];

// Bonus RPs that can only be earned on top of another, by season: category index →
// the index it needs. BIOBUZZ: Pollinator 1 is 4 tips and Pollinator 2 is 7.
const RP_REQUIRES: Record<number, Record<number, number>> = { 2026: { 2: 1 } };

// Matched against FIRST ranking scores: 3 for DECODE and BIOBUZZ, 2 before them.
export const winRpFor = (season: number) => (season >= 2025 ? 3 : 2);

/** Build the season simulation model from played matches + a team→EPA lookup.
 *  Falls back to the season-agnostic defaults until the sample is meaningful —
 *  a fit on a handful of early-season matches yields degenerate SDs (0 breaks
 *  win probability outright). */
export function computeSimModel(
  matches: SimMatch[],
  epaOf: (team: number) => number | undefined,
  season: number,
): SimModel {
  if (matches.length < 50) return { ...DEFAULT_SIM_MODEL, rp: { categories: [], winRp: winRpFor(season) } };
  const scores: number[] = [];
  const residuals: number[] = []; // actual margin − predicted (EPA) margin
  // Per RP category: (allianceEpaSum, earned) pairs.
  const xs: number[][] = RP_NAMES.map(() => []);
  const ys: number[][] = RP_NAMES.map(() => []);
  const requires = RP_REQUIRES[season] ?? {};

  const epaSum = (ts: number[]) =>
    ts.reduce((a, t) => a + (epaOf(t) ?? 0), 0);
  const addRp = (epa: number, rp: number[]) => {
    if (rp.length === 0) return;
    for (let c = 0; c < RP_NAMES.length; c++) {
      const needs = requires[c];
      if (needs != null && !rp[needs]) continue; // only rows where it was reachable
      xs[c].push(epa);
      ys[c].push(rp[c] ?? 0);
    }
  };

  for (const m of matches) {
    const rE = epaSum(m.redTeams);
    const bE = epaSum(m.blueTeams);
    scores.push(m.redNp, m.blueNp);
    residuals.push(m.redNp - m.blueNp - (rE - bE));
    addRp(rE, m.redRp);
    addRp(bE, m.blueRp);
  }

  const sm = mean(scores);
  // A category with no usable rows is left out rather than guessed at. Only the last
  // of a `requires` chain can go alone, so the indexes `requires` points at hold.
  const categories: RpCategory[] = RP_NAMES.flatMap((name, c) => {
    if (xs[c].length === 0) return [];
    const { a, b } = fitLogistic(xs[c], ys[c]);
    return [requires[c] != null ? { name, a, b, requires: requires[c] } : { name, a, b }];
  });
  return {
    scoreMean: Math.round(sm * 10) / 10,
    scoreSd: Math.round(sd(scores, sm) * 10) / 10,
    marginSd: Math.round(sd(residuals, mean(residuals)) * 10) / 10,
    rp: { categories, winRp: winRpFor(season) },
  };
}
