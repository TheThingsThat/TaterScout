// FTC seasons are keyed by their starting year (e.g. 2025 = the 2025–2026 season).
export const SEASON_NAMES: Record<number, string> = {
  2025: "DECODE",
  2024: "INTO THE DEEP",
  2023: "CENTERSTAGE",
  2022: "POWERPLAY",
  2021: "FREIGHT FRENZY",
  2020: "ULTIMATE GOAL",
  2019: "SKYSTONE",
};

export const CURRENT_SEASON = 2025;

export const SELECTABLE_SEASONS = Object.keys(SEASON_NAMES)
  .map(Number)
  .sort((a, b) => b - a);

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

/** Seasons whose scores are a single (non Trad/Remote) MatchScores type. */
export function seasonHasSimpleScores(season: number): boolean {
  return [2019, 2022, 2023, 2024, 2025].includes(season);
}
