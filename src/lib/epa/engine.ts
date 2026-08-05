// Expected Points Added (EPA) engine — the Statbotics model
// (statbotics.io/blog/epa), adapted from FRC's 3-team alliances to FTC's
// 2-team alliances. EPA is a point-unit Elo derivative: a team's rating is its
// predicted point contribution, updated after every match.
//
// Update rule, per team, per match:
//     Δ = (chase / allianceSize) · weight · (actual − predicted)
// where `chase` is the alliance-level absorption rate (see EpaConfig) and
// `weight` reduces playoff influence. Matching Statbotics' current model, there
// is NO opponent-margin term: their `margin_func` returns 0 for every modern
// season, and a backtest over the 2025 season confirmed it hurts FTC accuracy.
//
// Self-contained (no app imports) so it runs both in the Next app and in the
// standalone precompute script (scripts/build-epa.ts).

export interface EpaMatch {
  /** Chronological sort key (ms since epoch). */
  time: number;
  redTeams: number[];
  blueTeams: number[];
  /** No-penalty points (auto + teleop), excludes penalties. */
  redAuto: number;
  redTeleop: number;
  blueAuto: number;
  blueTeleop: number;
  /** Optional metadata used only when collecting trajectories. */
  eventCode?: string;
  playoff?: boolean;
  matchKey?: string;
  /**
   * False for a match that must NOT move ratings (an uneven alliance — see
   * compute.ts isFullMatch). It still yields a trajectory point carrying the
   * rating forward, so the chart shows every match a team actually played
   * instead of silently closing the gap.
   */
  rated?: boolean;
}

/** A team's EPA after a single match (for trajectory charts). */
export interface EpaTrajPoint {
  matchKey: string;
  time: number;
  eventCode: string;
  playoff: boolean;
  /** False when the match didn't move ratings (uneven alliance) — the chart
   *  draws it flat and labels it, rather than hiding the match entirely. */
  rated: boolean;
  epa: number;
  auto: number;
  teleop: number;
}

export interface EpaConfig {
  /**
   * ALLIANCE-level chase rate: the share of an alliance's surprise the alliance
   * absorbs, ramped by qual matches played. Each team receives its per-team
   * share (chase / alliance size), so the alliance's summed prediction moves
   * exactly `chase` toward the observation — a clean EWMA, matching Statbotics'
   * `err / num_teams` attribution. Empirically optimal for FTC's 2v2 at
   * 0.5 → 0.3 (Statbotics' 1/3 → 0.2 is tuned for FRC's 3-team alliances).
   */
  kEarly: number; // 0.5
  kLate: number; // 0.3
  kRampStart: number; // 6
  kRampEnd: number; // 12
  /** Playoff matches update at reduced weight (alliances are hand-picked, so
   *  results say less about individual contribution) and never age the ramp. */
  elimWeight: number; // 1/3
  /** Early-season baselines used to seed new teams (mean alliance scores). */
  baselineMeanTotal: number;
  baselineMeanAuto: number;
  /** Days from season start treated as the "Week 1" baseline window. */
  baselineWindowDays: number;
}

export const DEFAULT_CONFIG: EpaConfig = {
  kEarly: 0.5,
  kLate: 0.3,
  kRampStart: 6,
  kRampEnd: 12,
  elimWeight: 1 / 3,
  baselineMeanTotal: 80,
  baselineMeanAuto: 20,
  baselineWindowDays: 14,
};

export interface TeamEpa {
  epa: number; // total
  auto: number;
  teleop: number; // derived: epa − auto
  n: number; // matches counted
}

export interface EpaResult {
  config: EpaConfig;
  teams: Map<number, TeamEpa>;
}

function kFactor(n: number, cfg: EpaConfig): number {
  if (n <= cfg.kRampStart) return cfg.kEarly;
  if (n >= cfg.kRampEnd) return cfg.kLate;
  const span = cfg.kRampEnd - cfg.kRampStart;
  return cfg.kEarly - ((cfg.kEarly - cfg.kLate) * (n - cfg.kRampStart)) / span;
}

/** Mean alliance total & auto scores over the first `windowDays` of the season.
 *  Only rated (full-alliance) matches count — a robot-short alliance scores
 *  low, and letting that into the baseline would seed every new team too low. */
function fitBaselines(
  sorted: EpaMatch[],
  windowDays: number,
): { total: number; auto: number } {
  const rated = sorted.filter((m) => m.rated !== false);
  if (rated.length === 0) return { total: 80, auto: 20 };
  const cutoff = rated[0].time + windowDays * 24 * 3600 * 1000;
  let total = 0;
  let auto = 0;
  let cnt = 0;
  for (const m of rated) {
    if (m.time > cutoff) break;
    total += m.redAuto + m.redTeleop + (m.blueAuto + m.blueTeleop);
    auto += m.redAuto + m.blueAuto;
    cnt += 2;
  }
  // Fall back to the whole season if the early window is too thin.
  if (cnt < 100) {
    total = 0;
    auto = 0;
    cnt = 0;
    for (const m of rated) {
      total += m.redAuto + m.redTeleop + (m.blueAuto + m.blueTeleop);
      auto += m.redAuto + m.blueAuto;
      cnt += 2;
    }
  }
  return { total: cnt ? total / cnt : 80, auto: cnt ? auto / cnt : 20 };
}

/**
 * Replay all matches chronologically, updating every team's EPA after each.
 * Total and Auto EPA use the same update on their own surprise; TeleOp EPA is
 * the remainder (total − auto), which stays coherent because both components
 * share one rule.
 *
 * Callers must pass only matches with full alliances — an uneven alliance would
 * dump the whole shortfall onto whoever showed up (see compute.ts isFullMatch).
 */
export function computeEpa(
  matches: EpaMatch[],
  overrides: Partial<EpaConfig> = {},
  trajectories?: Map<number, EpaTrajPoint[]>,
): EpaResult {
  const sorted = [...matches].sort((a, b) => a.time - b.time);
  const base = fitBaselines(
    sorted,
    overrides.baselineWindowDays ?? DEFAULT_CONFIG.baselineWindowDays,
  );
  const cfg: EpaConfig = {
    ...DEFAULT_CONFIG,
    baselineMeanTotal: base.total,
    baselineMeanAuto: base.auto,
    ...overrides,
  };

  const initTotal = cfg.baselineMeanTotal / 2; // per-team (2 teams / alliance)
  const initAuto = cfg.baselineMeanAuto / 2;

  const teams = new Map<number, TeamEpa>();
  const get = (t: number): TeamEpa => {
    let e = teams.get(t);
    if (!e) {
      e = { epa: initTotal, auto: initAuto, teleop: initTotal - initAuto, n: 0 };
      teams.set(t, e);
    }
    return e;
  };

  for (const m of sorted) {
    const red = m.redTeams.map(get);
    const blue = m.blueTeams.map(get);
    if (red.length === 0 || blue.length === 0) continue;

    const predRed = red.reduce((s, e) => s + e.epa, 0);
    const predBlue = blue.reduce((s, e) => s + e.epa, 0);
    const predRedAuto = red.reduce((s, e) => s + e.auto, 0);
    const predBlueAuto = blue.reduce((s, e) => s + e.auto, 0);

    const actRed = m.redAuto + m.redTeleop;
    const actBlue = m.blueAuto + m.blueTeleop;

    // own-surprise = actual − predicted, for each alliance.
    const sRedTot = actRed - predRed;
    const sBlueTot = actBlue - predBlue;
    const sRedAuto = m.redAuto - predRedAuto;
    const sBlueAuto = m.blueAuto - predBlueAuto;

    // Playoff results move ratings less and never age the ramp (Statbotics'
    // ELIM_WEIGHT); `n` therefore counts qual matches, which is what k ramps on.
    const weight = m.playoff ? cfg.elimWeight : 1;
    const rated = m.rated !== false;

    const apply = (members: TeamEpa[], ownTot: number, ownAuto: number) => {
      if (!rated) return; // trajectory-only: rating carries forward unchanged
      // Each team absorbs its SHARE of the alliance's surprise, so the alliance
      // sum moves exactly `chase` toward the observation. Without this divisor
      // a 2-team alliance would chase 2x its intended rate.
      const share = weight / members.length;
      for (const e of members) {
        const chase = kFactor(e.n, cfg);
        // Total and auto use the identical rule, so teleop (= total − auto)
        // stays a coherent component rather than absorbing a rule mismatch.
        e.epa += chase * share * ownTot;
        e.auto += chase * share * ownAuto;
        e.teleop = e.epa - e.auto;
        if (!m.playoff) e.n += 1;
      }
    };

    apply(red, sRedTot, sRedAuto);
    apply(blue, sBlueTot, sBlueAuto);

    if (trajectories) {
      const r2 = (x: number) => Math.round(x * 100) / 100;
      for (const t of [...m.redTeams, ...m.blueTeams]) {
        const e = teams.get(t)!;
        let arr = trajectories.get(t);
        if (!arr) {
          arr = [];
          trajectories.set(t, arr);
        }
        arr.push({
          matchKey: m.matchKey ?? `${m.eventCode ?? ""}-${m.time}`,
          time: m.time,
          eventCode: m.eventCode ?? "",
          playoff: !!m.playoff,
          rated,
          epa: r2(e.epa),
          auto: r2(e.auto),
          teleop: r2(e.teleop),
        });
      }
    }
  }

  return { config: cfg, teams };
}
