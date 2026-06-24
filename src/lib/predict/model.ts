// Win / score / ranking-point model for the event simulator. Adapted from
// Statbotics' FRC "Simulate Champs" notebook to FTC (2v2). All season-specific
// constants (score SD, win-prob scale, RP calibration) are computed from data
// in the precompute (scripts/build-epa.ts) — see computeSimModel there.

export interface RpCategory {
  name: string; // e.g. "movementRp"
  a: number; // logistic intercept
  b: number; // logistic slope on alliance EPA-sum
}

export interface RpCalibration {
  categories: RpCategory[]; // P(earned) = sigmoid(a + b·allianceEpaSum)
  winRp: number; // RP for a win (tie = winRp/2); 0 if the season has no win RP
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
 * `result` is 1 (win), 0.5 (tie) or 0 (loss); `epaSum` is the alliance strength.
 * Bonus RPs are sampled from the calibrated per-category logistics.
 */
export function sampleRp(
  epaSum: number,
  result: number,
  model: SimModel,
  rand: () => number,
): number {
  let rp = model.rp.winRp * result;
  for (const c of model.rp.categories) {
    if (rand() < sigmoid(c.a + c.b * epaSum)) rp += 1;
  }
  return rp;
}

// --- calibration (precompute) ---
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function sd(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}

/** Fit P(y=1) = sigmoid(a + b·x) by binning x into quantiles and least-squares
 *  fitting logit(p) ~ x over the bin means (robust, no iterative solver). */
function fitLogistic(xs: number[], ys: number[], bins = 12): { a: number; b: number } {
  const idx = xs.map((_, i) => i).sort((p, q) => xs[p] - xs[q]);
  const per = Math.max(1, Math.floor(idx.length / bins));
  const bx: number[] = [];
  const bl: number[] = [];
  for (let s = 0; s < idx.length; s += per) {
    const grp = idx.slice(s, s + per);
    if (grp.length < 3) continue;
    const mx = mean(grp.map((i) => xs[i]));
    let p = mean(grp.map((i) => ys[i]));
    p = Math.min(0.98, Math.max(0.02, p));
    bx.push(mx);
    bl.push(Math.log(p / (1 - p)));
  }
  if (bx.length < 2) return { a: 0, b: 0 };
  const mxb = mean(bx);
  const mlb = mean(bl);
  let num = 0;
  let den = 0;
  for (let i = 0; i < bx.length; i++) {
    num += (bx[i] - mxb) * (bl[i] - mlb);
    den += (bx[i] - mxb) * (bx[i] - mxb);
  }
  const b = den === 0 ? 0 : num / den;
  return { a: mlb - b * mxb, b };
}

export interface SimMatch {
  redTeams: number[];
  blueTeams: number[];
  redNp: number;
  blueNp: number;
  redRp: number[]; // [movement, goal, pattern] 0/1
  blueRp: number[];
}

const RP_NAMES = ["movementRp", "goalRp", "patternRp"];

/** Build the season simulation model from played matches + a team→EPA lookup. */
export function computeSimModel(
  matches: SimMatch[],
  epaOf: (team: number) => number | undefined,
  winRp = 2,
): SimModel {
  const scores: number[] = [];
  const residuals: number[] = []; // actual margin − predicted (EPA) margin
  // Per RP category: (allianceEpaSum, earned) pairs.
  const xs: number[][] = RP_NAMES.map(() => []);
  const ys: number[][] = RP_NAMES.map(() => []);

  const epaSum = (ts: number[]) =>
    ts.reduce((a, t) => a + (epaOf(t) ?? 0), 0);

  for (const m of matches) {
    const rE = epaSum(m.redTeams);
    const bE = epaSum(m.blueTeams);
    scores.push(m.redNp, m.blueNp);
    residuals.push(m.redNp - m.blueNp - (rE - bE));
    for (let c = 0; c < RP_NAMES.length; c++) {
      xs[c].push(rE, bE);
      ys[c].push(m.redRp[c] ?? 0, m.blueRp[c] ?? 0);
    }
  }

  const sm = mean(scores);
  const categories: RpCategory[] = RP_NAMES.map((name, c) => {
    const { a, b } = fitLogistic(xs[c], ys[c]);
    return { name, a, b };
  });
  return {
    scoreMean: Math.round(sm * 10) / 10,
    scoreSd: Math.round(sd(scores, sm) * 10) / 10,
    marginSd: Math.round(sd(residuals, mean(residuals)) * 10) / 10,
    rp: { categories, winRp },
  };
}
