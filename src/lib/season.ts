// FTC seasons are keyed by their starting year (e.g. 2025 = the 2025–2026 season).
const SEASON_NAMES: Record<number, string> = {
  2026: "BIOBUZZ",
  2025: "DECODE",
  2024: "INTO THE DEEP",
  2023: "CENTERSTAGE",
  2022: "POWERPLAY",
  2021: "FREIGHT FRENZY",
  2020: "ULTIMATE GOAL",
  2019: "SKYSTONE",
};

export const CURRENT_SEASON = 2026;

export function seasonLabel(season: number): string {
  return `${season}–${season + 1}`;
}

export function seasonName(season: number): string {
  return SEASON_NAMES[season] ?? "";
}

export function seasonFull(season: number): string {
  const name = seasonName(season);
  return name ? `${seasonLabel(season)} · ${name}` : seasonLabel(season);
}

/** A season we actually have data for. Clamp URL/query input through this so a
 *  stranger can't drive fetches or dataset writes with arbitrary numbers. */
export function isKnownSeason(season: number): boolean {
  return Object.prototype.hasOwnProperty.call(SEASON_NAMES, season);
}

/** Seasons whose qualification rankings were by total score, not ranking points
 *  (ULTIMATE GOAL and FREIGHT FRENZY), so seed and RP predictions don't apply. */
export function rankedByRp(season: number): boolean {
  return season !== 2020 && season !== 2021;
}

/** What a season's ratings leave out: remote events were single-team matches,
 *  which EPA/OPR (2v2 alliance ratings) can't use. */
export function ratingsCoverageNote(season: number): string | null {
  if (season === 2020) return "Most of 2020–21 was played remotely as single-team matches, which aren't rated, so ratings cover only the in-person events.";
  if (season === 2021) return "Remote events (about 1 in 6 that season) were single-team matches and aren't rated.";
  return null;
}

/** Every season with data, newest first. */
export function allSeasons(): number[] {
  return Object.keys(SEASON_NAMES).map(Number).sort((a, b) => b - a);
}

export function pastSeasons(): number[] {
  return Object.keys(SEASON_NAMES).map(Number).filter((s) => s < CURRENT_SEASON);
}

/** Parse untrusted season input, falling back to the current season. */
export function parseSeasonParam(raw: string | number | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && isKnownSeason(n) ? n : CURRENT_SEASON;
}

/** FIRST event codes are short alphanumerics; reject anything else so user input
 *  can't inject path/query segments into credentialed FIRST API URLs. */
export function isValidEventCode(code: string): boolean {
  return /^[A-Z0-9]{2,20}$/.test(code);
}
