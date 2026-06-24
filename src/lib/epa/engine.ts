// Expected Points Added (EPA) engine — the Statbotics model
// (statbotics.io/blog/epa), adapted from FRC's 3-team alliances to FTC's
// 2-team alliances. EPA is a point-unit Elo derivative: a team's rating is its
// predicted point contribution, updated after every match.
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
}

/** A team's EPA after a single match (for trajectory charts). */
export interface EpaTrajPoint {
  matchKey: string;
  time: number;
  eventCode: string;
  playoff: boolean;
  epa: number;
  auto: number;
  teleop: number;
}

export interface EpaConfig {
  /** k-factor (update rate) ramp by matches played. */
  kEarly: number; // 0.5
  kLate: number; // 0.3
  kRampStart: number; // 6
  kRampEnd: number; // 12
  /** Margin parameter M ramp by matches played: 0 (offense only) → 1 (margin). */
  mRampStart: number; // 12
  mRampEnd: number; // 36
  mMax: number; // 1
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
  mRampStart: 12,
  mRampEnd: 36,
  mMax: 1,
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

function mParam(n: number, cfg: EpaConfig): number {
  if (n <= cfg.mRampStart) return 0;
  if (n >= cfg.mRampEnd) return cfg.mMax;
  const span = cfg.mRampEnd - cfg.mRampStart;
  return (cfg.mMax * (n - cfg.mRampStart)) / span;
}

/** Mean alliance total & auto scores over the first `windowDays` of the season. */
function fitBaselines(
  sorted: EpaMatch[],
  windowDays: number,
): { total: number; auto: number } {
  if (sorted.length === 0) return { total: 80, auto: 20 };
  const cutoff = sorted[0].time + windowDays * 24 * 3600 * 1000;
  let total = 0;
  let auto = 0;
  let cnt = 0;
  for (const m of sorted) {
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
    for (const m of sorted) {
      total += m.redAuto + m.redTeleop + (m.blueAuto + m.blueTeleop);
      auto += m.redAuto + m.blueAuto;
      cnt += 2;
    }
  }
  return { total: cnt ? total / cnt : 80, auto: cnt ? auto / cnt : 20 };
}

/**
 * Replay all matches chronologically, updating every team's EPA after each.
 * Total EPA uses the margin-parameter update; Auto EPA uses an offense-only
 * (M=0) update; TeleOp EPA is the remainder (total − auto), exactly as
 * Statbotics derives the alliance-interaction component.
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

    const apply = (
      members: TeamEpa[],
      ownTot: number,
      oppTot: number,
      ownAuto: number,
    ) => {
      for (const e of members) {
        const k = kFactor(e.n, cfg);
        const M = mParam(e.n, cfg);
        const dTotal = (k / (1 + M)) * (ownTot - M * oppTot);
        const dAuto = k * ownAuto; // component update uses M = 0
        e.epa += dTotal;
        e.auto += dAuto;
        e.teleop = e.epa - e.auto;
        e.n += 1;
      }
    };

    apply(red, sRedTot, sBlueTot, sRedAuto);
    apply(blue, sBlueTot, sRedTot, sBlueAuto);

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
          epa: r2(e.epa),
          auto: r2(e.auto),
          teleop: r2(e.teleop),
        });
      }
    }
  }

  return { config: cfg, teams };
}
