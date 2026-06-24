// Predict when upcoming qualification matches will actually start, following
// The Blue Alliance's method (blog.thebluealliance.com/2017/05/11). Events run
// behind their published schedule; we estimate the real "cycle time" from
// already-played matches and project the remaining ones forward.
//
// Self-contained (no app imports) so it runs in the app and in the offline
// verification script (scripts/verify-predict.ts). Pass qualification matches
// only — playoffs are bracket/alliance-dependent.

export interface SchedMatch {
  key: string;
  scheduled: number | null; // ms epoch
  actual: number | null; // ms epoch (null until scored)
  played: boolean;
}

export interface PredictConfig {
  breakThresholdSec: number; // scheduled gaps longer than this are breaks
  outlierFactor: number; // real cycle > factor × scheduled = outlier
  biasReal: number;
  biasSched: number;
  percentile: number; // conservative percentile of biased cycles
  /** Dynamic per-season baseline cycle (the prior), in seconds. Computed from
   *  the whole season's matches; replaces a hardcoded default. */
  seasonPriorSec: number;
  /** Shrinkage pseudo-count K: the live per-event cycle gets weight
   *  n/(n+K), so it overtakes the season prior as ~K cycles are played. */
  priorPseudoCount: number;
}

// Ported from TBA (FRC 2017). `seasonPriorSec` is normally overridden with the
// value computed by the precompute; 330s is just a hard fallback.
export const FTC_DEFAULTS: PredictConfig = {
  breakThresholdSec: 900,
  outlierFactor: 1.5,
  biasReal: 0.7,
  biasSched: 0.3,
  percentile: 0.35,
  seasonPriorSec: 330,
  priorPseudoCount: 4,
};

export interface PredictResult {
  idealCycleSec: number; // the blended cycle actually used
  eventCycleSec: number | null; // live per-event estimate (null if none yet)
  weight: number; // weight placed on the event cycle, 0..1
  predicted: Map<string, number>; // unplayed match key -> predicted start ms
  lastPlayedMs: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface CyclePriors {
  overallSec: number;
  byTypeSec: Record<string, number>; // event-type → baseline cycle (sec)
  sampleCount: number;
}

/**
 * Season baseline cycle(s) from played qualification matches across the whole
 * season — the "average gap between matches" prior. Uses real (actual-time)
 * cycles, excludes breaks (>threshold), and takes the same conservative
 * percentile as the live estimator. Produces an overall value plus per
 * event-type values (Championships, Qualifiers, … cycle at different paces).
 */
export function computeSeasonCyclePriors(
  events: { type: string; qualTimesMs: number[] }[],
  cfg: PredictConfig = FTC_DEFAULTS,
  minTypeSamples = 200,
): CyclePriors {
  const breakMs = cfg.breakThresholdSec * 1000;
  const overall: number[] = [];
  const byType: Record<string, number[]> = {};
  for (const ev of events) {
    const t = [...ev.qualTimesMs].sort((a, b) => a - b);
    for (let i = 0; i + 1 < t.length; i++) {
      const gap = t[i + 1] - t[i];
      if (gap <= 0 || gap > breakMs) continue; // skip breaks / zero / negatives
      overall.push(gap);
      (byType[ev.type] ??= []).push(gap);
    }
  }
  const pctSec = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return percentile(s, cfg.percentile) / 1000;
  };
  const byTypeSec: Record<string, number> = {};
  for (const [type, arr] of Object.entries(byType)) {
    if (arr.length >= minTypeSamples) byTypeSec[type] = Math.round(pctSec(arr));
  }
  return {
    overallSec: overall.length ? Math.round(pctSec(overall)) : cfg.seasonPriorSec,
    byTypeSec,
    sampleCount: overall.length,
  };
}

export function predictMatchTimes(
  matches: SchedMatch[],
  cfg: PredictConfig = FTC_DEFAULTS,
): PredictResult {
  // Order by scheduled time (fall back to actual).
  const ms = [...matches].sort((a, b) => {
    const as = a.scheduled ?? a.actual ?? Infinity;
    const bs = b.scheduled ?? b.actual ?? Infinity;
    return as - bs;
  });

  const breakMs = cfg.breakThresholdSec * 1000;

  // --- Ideal cycle from consecutive played pairs ---
  const biased: number[] = [];
  for (let i = 0; i + 1 < ms.length; i++) {
    const a = ms[i];
    const b = ms[i + 1];
    if (!a.played || !b.played) continue;
    if (a.actual == null || b.actual == null || a.scheduled == null || b.scheduled == null) continue;
    const schedCycle = b.scheduled - a.scheduled;
    const realCycle = b.actual - a.actual;
    if (schedCycle <= 0 || realCycle <= 0) continue;
    if (schedCycle > breakMs) continue; // scheduled break
    if (realCycle > cfg.outlierFactor * schedCycle) continue; // connectivity/repair outlier
    biased.push(cfg.biasReal * realCycle + cfg.biasSched * schedCycle);
  }
  biased.sort((x, y) => x - y);
  // Blend the live per-event cycle with the season prior: weight the event
  // estimate by n/(n+K) so it sharpens as more matches are played, and falls
  // back to the season baseline when the event has little/no data yet.
  const prior = cfg.seasonPriorSec * 1000;
  const eventCycle = biased.length > 0 ? percentile(biased, cfg.percentile) : null;
  let weight = 0;
  let idealCycle: number;
  if (eventCycle == null) {
    idealCycle = prior;
  } else {
    weight = biased.length / (biased.length + cfg.priorPseudoCount);
    idealCycle = weight * eventCycle + (1 - weight) * prior;
  }

  // --- Anchor at the most recent played match (in schedule order) ---
  let lastPlayedIdx = -1;
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].played && ms[i].actual != null) lastPlayedIdx = i;
  }

  const predicted = new Map<string, number>();

  if (lastPlayedIdx === -1) {
    // Nothing played yet — best guess is the published schedule.
    for (const m of ms) if (!m.played && m.scheduled != null) predicted.set(m.key, m.scheduled);
    return {
      idealCycleSec: idealCycle / 1000,
      eventCycleSec: eventCycle != null ? eventCycle / 1000 : null,
      weight,
      predicted,
      lastPlayedMs: null,
    };
  }

  // --- Project forward, re-inserting scheduled breaks ---
  let prevTime = ms[lastPlayedIdx].actual as number;
  let prevSched = ms[lastPlayedIdx].scheduled;
  for (let i = lastPlayedIdx + 1; i < ms.length; i++) {
    const m = ms[i];
    let inc = idealCycle;
    if (prevSched != null && m.scheduled != null) {
      const schedGap = m.scheduled - prevSched;
      if (schedGap > breakMs) inc = schedGap; // preserve the real break
    }
    prevTime += inc;
    prevSched = m.scheduled ?? prevSched;
    if (!m.played) predicted.set(m.key, prevTime);
  }

  return {
    idealCycleSec: idealCycle / 1000,
    eventCycleSec: eventCycle != null ? eventCycle / 1000 : null,
    weight,
    predicted,
    lastPlayedMs: ms[lastPlayedIdx].actual,
  };
}
