// Rules for reading FIRST's match rows, shared by the crawl (ratings) and the live
// page queries so the two can't disagree. Imports stay out so tsx scripts can use it.

const formatters = new Map<string, Intl.DateTimeFormat>();

/** How far `tz` is ahead of UTC at the instant `utcMs`. Throws on an unknown zone. */
function zoneOffsetMs(utcMs: number, tz: string): number {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(utcMs)) p[type] = Number(value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/**
 * FIRST's date-times are the venue's wall clock with no offset ("2026-10-31T09:05:06.96"
 * at an Atlanta event means 09:05 Eastern). Date.parse would read them in the server's
 * zone, so they'd shift with whichever machine ran the code. Returns null for a missing
 * or unreadable value, and for FIRST's year-0001 placeholder schedule times.
 */
export function venueTimeMs(
  value: string | null | undefined,
  timezone: string | null | undefined,
): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(value);
  if (!m) {
    const t = Date.parse(value); // carries its own offset
    return Number.isNaN(t) ? null : t;
  }
  if (Number(m[1]) <= 2000) return null;
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), ms);
  if (!timezone) return wall;
  try {
    // Second pass lands on the right side of a daylight-saving change.
    return wall - zoneOffsetMs(wall - zoneOffsetMs(wall, timezone), timezone);
  } catch {
    return wall; // unknown zone
  }
}

/** venueTimeMs as an ISO instant, the form Match carries and pages Date.parse. */
export function venueTimeIso(
  value: string | null | undefined,
  timezone: string | null | undefined,
): string | null {
  const ms = venueTimeMs(value, timezone);
  return ms === null ? null : new Date(ms).toISOString();
}

/** The calendar date ("YYYY-MM-DD") at the venue right now. */
export function venueToday(timezone: string | null | undefined, now: number): string {
  try {
    return new Date(now).toLocaleDateString("en-CA", { timeZone: timezone || "UTC" });
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** A match has been played once both finals are posted. 0-0 counts as not played:
 *  BIOBUZZ's only ones are placeholders posted seconds apart (its next-lowest total
 *  is 18), and a real one is rare enough to give up (2 in ~4,300 sampled in-person
 *  rows from past seasons). Remote events have no alliances; see isAllianceMatch. */
export const isScored = (
  redFinal: number | null | undefined,
  blueFinal: number | null | undefined,
): boolean =>
  typeof redFinal === "number" && typeof blueFinal === "number" && (redFinal > 0 || blueFinal > 0);

/** False for remote events' rows, where each team plays alone on a station "1". */
export const isAllianceMatch = (teams: { station: string }[]): boolean =>
  teams.every((t) => t.station.startsWith("Red") || t.station.startsWith("Blue"));

interface StationTeam {
  teamNumber: number | null;
  station: string;
  onField: boolean;
}

interface MatchRowScores {
  scoreRedFinal: number | null;
  scoreRedFoul: number | null;
  scoreBlueFinal: number | null;
  scoreBlueFoul: number | null;
}

/** One alliance's robots that played. In a played match, nobody flagged on an alliance
 *  that scored points itself, or nobody flagged in the whole match, is an upstream
 *  artifact rather than no-shows, so the flag is ignored there. Points that are only
 *  the opponent's penalties (`score{X}Foul` is what X committed) prove nothing. */
export function teamsOnField<T extends StationTeam>(
  teams: T[],
  side: "Red" | "Blue",
  m: MatchRowScores,
): T[] {
  const mine = teams.filter((t) => t.teamNumber != null && t.station.startsWith(side));
  const flagged = mine.filter((t) => t.onField);
  if (flagged.length > 0 || !isScored(m.scoreRedFinal, m.scoreBlueFinal)) return flagged;
  const own =
    side === "Red"
      ? (m.scoreRedFinal ?? 0) - (m.scoreBlueFoul ?? 0)
      : (m.scoreBlueFinal ?? 0) - (m.scoreRedFoul ?? 0);
  return own > 0 || !teams.some((t) => t.onField) ? mine : [];
}
