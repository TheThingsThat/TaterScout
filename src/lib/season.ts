// FTC seasons are keyed by their starting year (e.g. 2025 = the 2025–2026 season).
const SEASON_NAMES: Record<number, string> = {
  2025: "DECODE",
  2024: "INTO THE DEEP",
  2023: "CENTERSTAGE",
  2022: "POWERPLAY",
  2021: "FREIGHT FRENZY",
  2020: "ULTIMATE GOAL",
  2019: "SKYSTONE",
};

export const CURRENT_SEASON = 2025;

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
