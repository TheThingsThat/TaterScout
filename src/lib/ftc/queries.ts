// Live data access for pages. Team/event detail come straight from the official
// FIRST Events API (first.ts); season snapshot, world record and search read our
// precomputed store (FIRST has no season-OPR or fuzzy-search endpoints).
import { unstable_cache } from "next/cache";
import { firstGet } from "./first";
import { levelOf, normalizeEventType } from "./labels";
import { isAllianceMatch, isScored, teamsOnField, venueTimeIso, venueTimeMs, venueToday } from "./match";
import { buildBreakdown, type ScoreRow } from "./breakdown";
import { siteMeta, siteSearch } from "../data/convexSite";
import { CURRENT_SEASON, isKnownSeason, isValidEventCode } from "../season";
import type {
  Team,
  TeamSearchResult,
  EventSearchResult,
  EventIndexRow,
  EventDetail,
  EventTeam,
  EventAward,
  EventAlliance,
  Match,
  MatchTeam,
  TeamEventLite,
  AwardLite,
} from "./types";

// --- FIRST response shapes (only the fields we use) ---
interface FEvent {
  code: string;
  divisionCode: string | null;
  name: string | null;
  typeName: string | null;
  remote: boolean;
  city: string | null;
  stateprov: string | null;
  country: string | null;
  regionCode: string | null;
  website: string | null;
  liveStreamUrl: string | null;
  timezone: string | null;
  dateStart: string | null;
  dateEnd: string | null;
}
interface FTeam {
  teamNumber: number;
  nameShort: string | null;
  nameFull: string | null;
  schoolName: string | null;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  website: string | null;
  rookieYear: number | null;
  homeRegion: string | null;
}
// Hybrid schedule row = every scheduled match (future + played), results folded
// in where available. This is what surfaces UPCOMING matches; /matches is
// results-only, so it omits them.
interface FHybridTeam {
  teamNumber: number | null; // null until a playoff slot is decided
  station: string;
  onField: boolean;
  surrogate?: boolean;
  dq?: boolean;
  teamName: string | null;
}
interface FHybridMatch {
  tournamentLevel: string;
  series: number;
  matchNumber: number;
  startTime: string | null; // scheduled
  actualStartTime: string | null;
  postResultTime: string | null;
  scoreRedFinal: number | null;
  scoreRedFoul: number | null;
  scoreRedAuto: number | null;
  scoreBlueFinal: number | null;
  scoreBlueFoul: number | null;
  scoreBlueAuto: number | null;
  teams: FHybridTeam[];
}
interface FMatchScore {
  matchLevel: string;
  matchSeries: number;
  matchNumber: number;
  alliances?: ScoreRow[]; // absent on remote events' rows
}
interface FRanking {
  rank: number;
  teamNumber: number;
  teamName: string | null;
  sortOrder1: number | null; // ranking score
}
interface FAllianceTeam {
  teamNumber: number;
}
interface FAlliance {
  number: number;
  captain: FAllianceTeam | null;
  round1: FAllianceTeam | null;
  round2: FAllianceTeam | null;
  round3: FAllianceTeam | null;
  backup: FAllianceTeam | null;
}
interface FAward {
  eventCode: string;
  name: string;
  series: number;
  teamNumber: number | null;
}

const REVALIDATE = 60; // seconds for live page fetches
const SETTLED_REVALIDATE = 86400;
/** A finished season's FIRST data no longer changes: cache it for a day. */
const ttl = (season: number) => (season < CURRENT_SEASON ? SETTLED_REVALIDATE : REVALIDATE);
const SETTLED_AFTER_MS = 14 * 86400000; // past the longest sync sweep window
// The season's event list (~1 MB) changes a few times a week, not each minute. A new
// event, or an edit to one's name, dates or timezone, can take an hour to show.
const LIST_REVALIDATE = 3600;
const listTtl = (season: number) => (season < CURRENT_SEASON ? SETTLED_REVALIDATE : LIST_REVALIDATE);
/** Every caller uses this, so they all share one cache entry for the list. */
const getSeasonEventsRaw = (season: number) =>
  firstGet<{ events: FEvent[] }>(`${season}/events`, { revalidate: listTtl(season) });

const now = () => Date.now();
const parse = (s: string | null | undefined, tz: string | null) => venueTimeMs(s, tz) ?? NaN;
/** An event is "ongoing" from its start date through the day after it ends. */
function isOngoing(start: string | null, end: string | null, tz: string | null): boolean {
  const s = parse(start, tz);
  const e = parse(end ?? start, tz) + 86400000;
  const t = now();
  return !Number.isNaN(s) && t >= s && t <= e;
}

/** Map a FIRST award name + series to our canonical {type, placement}. */
function mapAward(name: string, series: number): { type: string; placement: number } {
  // Drop a championship "<X> Division " prefix so a division win/award reads the
  // same as a regular one (no special-casing divisions or finals).
  const n = name.replace(/^.*?\bDivision\s+/i, "");
  if (/^Inspire/i.test(n)) return { type: "Inspire", placement: series };
  if (/Winning Alliance/i.test(n)) return { type: "Winner", placement: series };
  if (/Finalist Alliance/i.test(n)) return { type: "Finalist", placement: series };
  // Other judged awards: strip the "2nd/3rd Place" suffix; series carries place.
  const base = n.replace(/\s+\d+(st|nd|rd|th)\s+Place$/i, "").trim();
  return { type: base, placement: series };
}

// ---------------------------------------------------------------------------
// TEAM
// ---------------------------------------------------------------------------
function toTeamEvent(e: FEvent, season: number): TeamEventLite {
  return {
    eventCode: e.code,
    event: {
      name: e.name ?? e.code,
      code: e.code,
      start: e.dateStart ?? "",
      end: e.dateEnd ?? e.dateStart ?? "",
      type: normalizeEventType(e.typeName, season),
      ongoing: isOngoing(e.dateStart, e.dateEnd, e.timezone),
      timezone: e.timezone ?? "UTC",
      location: { city: e.city, state: e.stateprov, country: e.country },
    },
  };
}

/**
 * A team's FIRST record for the season, or null if FIRST has none. FIRST answers an
 * unknown team with 400, which the fetch cache never stores, so this caches the
 * answer itself, not-founds included: an invented number costs one FIRST call per
 * window rather than per request. Transient failures throw, so they're never cached.
 */
const teamRowCached = unstable_cache(
  async (number: number, season: number): Promise<FTeam | null> =>
    (await firstGet<{ teams: FTeam[] }>(`${season}/teams?teamNumber=${number}`, { revalidate: 3600 }))
      ?.teams?.[0] ?? null,
  ["team-row"],
  { revalidate: 900 },
);

export async function getTeam(number: number, season: number): Promise<Team | null> {
  // Existence first, so an unknown number never reaches the events/awards calls.
  const t = await teamRowCached(number, season);
  if (!t) return null;
  const [eventsR, awardsR] = await Promise.all([
    firstGet<{ events: FEvent[] }>(`${season}/events?teamNumber=${number}`, { revalidate: ttl(season) }),
    firstGet<{ awards: FAward[] }>(`${season}/awards/${number}`, { revalidate: ttl(season) }),
  ]);

  const events = (eventsR?.events ?? []).map((e) => toTeamEvent(e, season));
  const nameByCode = new Map(events.map((e) => [e.eventCode, e.event.name]));

  const awards: AwardLite[] = (awardsR?.awards ?? []).map((a) => {
    const { type, placement } = mapAward(a.name, a.series);
    return {
      type,
      placement,
      eventCode: a.eventCode,
      event: { name: nameByCode.get(a.eventCode) ?? a.eventCode },
    };
  });

  return {
    number: t.teamNumber,
    name: t.nameShort ?? `Team ${t.teamNumber}`,
    schoolName: t.schoolName,
    sponsors: [],
    location: { city: t.city, state: t.stateProv, country: t.country },
    rookieYear: t.rookieYear ?? 0,
    website: t.website || null,
    activeSeasons: [season],
    quickStats: null, // season OPR comes from our rankings store (see team page)
    events,
    awards,
  };
}

export interface TeamUpcoming {
  number: number;
  name: string;
  /** The event the team is at now, else its next one this season; null if none. */
  next: (TeamEventLite["event"] & { startMs: number | null; endMs: number | null }) | null;
}

/**
 * A team's name and this season's events with venue start/end instants, for the
 * starred-teams view. Same FIRST URLs as getTeam (shared fetch-cache entries), but
 * the result is cached 15 minutes as a whole, unknown teams included, so the
 * homepage doesn't refresh every starred team each minute and an invented team
 * number costs FIRST calls once per window rather than per request. Transient
 * FIRST failures throw, so they're never cached.
 */
const teamEventsCached = unstable_cache(
  async (number: number, season: number) => {
    const [teamR, eventsR] = await Promise.all([
      firstGet<{ teams: FTeam[] }>(`${season}/teams?teamNumber=${number}`, { revalidate: 3600 }),
      firstGet<{ events: FEvent[] }>(`${season}/events?teamNumber=${number}`, { revalidate: REVALIDATE }),
    ]);
    const t = teamR?.teams?.[0];
    if (!t) return null;
    return {
      number: t.teamNumber,
      name: t.nameShort ?? `Team ${t.teamNumber}`,
      events: (eventsR?.events ?? []).map((e) => {
        const startMs = venueTimeMs(e.dateStart, e.timezone);
        // Through the end of its last day at the venue (as isOngoing counts it).
        const end = venueTimeMs(e.dateEnd ?? e.dateStart, e.timezone);
        return { ...toTeamEvent(e, season).event, startMs, endMs: end === null ? null : end + 86400000 };
      }),
    };
  },
  ["team-upcoming"],
  { revalidate: 900 },
);

/** A team's name and current-or-next event (null if neither); null for an unknown team. */
export async function getTeamUpcoming(number: number, season: number): Promise<TeamUpcoming | null> {
  const team = await teamEventsCached(number, season);
  if (!team) return null;
  const t0 = now();
  // `ongoing` is recomputed here: the cached copy can be up to 15 minutes old.
  const live = (e: { startMs: number | null; endMs: number | null }) =>
    e.startMs !== null && e.startMs <= t0 && (e.endMs === null || t0 < e.endMs);
  const candidates = team.events
    .map((e) => ({ ...e, ongoing: live(e) }))
    .filter((e) => e.ongoing || (e.startMs !== null && e.startMs > t0))
    // At an event now beats a later one; then soonest first.
    .sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  return { number: team.number, name: team.name, next: candidates[0] ?? null };
}

// ---------------------------------------------------------------------------
// EVENT
// ---------------------------------------------------------------------------
/** Team number → display name for an event roster (paginated). */
async function fetchEventTeamNames(season: number, code: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  let page = 1;
  let total = 1;
  do {
    const r = await firstGet<{ teams: FTeam[]; pageTotal: number }>(
      `${season}/teams?eventCode=${code}&page=${page}`,
      { revalidate: 3600 },
    );
    for (const t of r?.teams ?? [])
      map.set(t.teamNumber, t.nameShort ?? `Team ${t.teamNumber}`);
    total = r?.pageTotal ?? 1;
    page++;
  } while (page <= total);
  return map;
}

/**
 * This code's row in FIRST's season list: null = not a real code, undefined = the
 * list is unavailable. The list is ONE cached fetch shared by every request
 * (search uses it too), so a legitimate page pays nothing extra, and the row
 * itself replaces a separate per-event detail fetch.
 *
 * Without this gate, `/events/2025/<anything>` fans out to ~9 credentialed
 * FIRST calls before discovering the event doesn't exist — and since the data
 * cache keys on the code, every invented code is a fresh miss. That let an
 * anonymous visitor burn our single shared FIRST credential at 9x their own
 * request rate. Fails OPEN: if the list is unavailable we serve the page
 * rather than 404 real events over a transient upstream hiccup.
 */
async function findListedEvent(season: number, code: string): Promise<FEvent | null | undefined> {
  try {
    const list = (await getSeasonEventsRaw(season))?.events ?? [];
    if (list.length === 0) return undefined;
    const want = code.toUpperCase();
    return list.find((e) => e.code.toUpperCase() === want) ?? null;
  } catch {
    return undefined;
  }
}

/** A fetch that may fail without taking the rest of the page with it: some events
 *  answer 403 or 500 on /scores and /rankings while their schedule is fine. */
const optional = <T,>(p: Promise<T | null>): Promise<T | null> => p.catch(() => null);

const getEventRankings = (season: number, code: string, revalidate = REVALIDATE) =>
  firstGet<{ rankings: FRanking[] }>(`${season}/rankings/${code}`, { revalidate });

/** How long the team page may cache one event's data. A team has several events, and
 *  the ones that ended long ago won't change. */
const teamPageRevalidate = (season: number, eventEnd: string, tz: string): number =>
  season < CURRENT_SEASON || now() - parse(eventEnd, tz) > SETTLED_AFTER_MS ? SETTLED_REVALIDATE : REVALIDATE;

/** Join an event's hybrid schedule rows with its /scores rows into Match[]. */
function buildMatches(
  season: number,
  timezone: string | null,
  schedule: FHybridMatch[],
  scores: FMatchScore[],
): Match[] {
  const scoreByKey = new Map<string, { red?: ScoreRow; blue?: ScoreRow }>();
  for (const s of scores) {
    const key = `${s.matchLevel}|${s.matchSeries}|${s.matchNumber}`;
    const e = scoreByKey.get(key) ?? {};
    for (const a of s.alliances ?? []) {
      if (a.alliance === "Red") e.red = a;
      else e.blue = a;
    }
    scoreByKey.set(key, e);
  }

  const matches: Match[] = [];
  for (const m of schedule) {
    if (m.tournamentLevel === "PRACTICE" || !isAllianceMatch(m.teams)) continue;
    const sc = scoreByKey.get(`${m.tournamentLevel}|${m.series}|${m.matchNumber}`);
    const played = isScored(m.scoreRedFinal, m.scoreBlueFinal);
    const onField = new Set([
      ...teamsOnField(m.teams, "Red", m),
      ...teamsOnField(m.teams, "Blue", m),
    ]);
    const teams: MatchTeam[] = m.teams.flatMap((t) =>
      t.teamNumber == null
        ? []
        : [
            {
              teamNumber: t.teamNumber,
              alliance: t.station.startsWith("Red") ? ("Red" as const) : ("Blue" as const),
              station: t.station,
              allianceRole: null,
              surrogate: t.surrogate === true,
              dq: t.dq === true,
              onField: onField.has(t),
            },
          ],
    );
    // Totals come from the hybrid row, not the score breakdown — FIRST serves
    // the breakdown zeroed until a new season's score model ships (see crawl.ts).
    // `score{X}Foul` is what X committed, so X's no-penalty score subtracts the
    // OPPONENT's foul.
    const redNp = (m.scoreRedFinal ?? 0) - (m.scoreBlueFoul ?? 0);
    const blueNp = (m.scoreBlueFinal ?? 0) - (m.scoreRedFoul ?? 0);
    const level = levelOf(m.tournamentLevel);
    matches.push({
      matchNum: m.matchNumber,
      tournamentLevel: level,
      series: m.series,
      hasBeenPlayed: played,
      scheduledStartTime: venueTimeIso(m.startTime, timezone),
      actualStartTime: venueTimeIso(m.actualStartTime, timezone),
      postResultTime: venueTimeIso(m.postResultTime, timezone),
      teams,
      scores: played
        ? {
            red: {
              totalPoints: m.scoreRedFinal ?? 0,
              totalPointsNp: redNp,
              autoPoints: m.scoreRedAuto,
            },
            blue: {
              totalPoints: m.scoreBlueFinal ?? 0,
              totalPointsNp: blueNp,
              autoPoints: m.scoreBlueAuto,
            },
          }
        : null,
      breakdown: played
        ? buildBreakdown(season, level === "Quals", sc?.red, sc?.blue, m.scoreRedFinal, m.scoreBlueFinal)
        : null,
    });
  }
  return matches;
}

export async function getEvent(season: number, rawCode: string): Promise<EventDetail | null> {
  // Clamp here, not only in the page: generateMetadata passes raw URL params, and an
  // unknown season has no list to gate on (it would fail open into ~9 FIRST calls).
  const want = rawCode.toUpperCase();
  if (!Number.isInteger(season) || !isKnownSeason(season) || !isValidEventCode(want)) return null;
  const listed = await findListedEvent(season, want);
  if (listed === null) return null;
  // FIRST's own spelling, so every casing of a URL shares one set of cache entries.
  const code = listed?.code ?? want;
  // An event that ended long ago won't change: cache it like the team page does.
  const rv = listed
    ? teamPageRevalidate(season, listed.dateEnd ?? listed.dateStart ?? "", listed.timezone ?? "UTC")
    : ttl(season);
  const [detailR, qualHybR, poHybR, qs, ps, rankR, allianceR, awardR, names] = await Promise.all([
    // The listed row is the same object; fetch it alone only when the list was unavailable.
    listed
      ? Promise.resolve({ events: [listed] })
      : firstGet<{ events: FEvent[] }>(`${season}/events?eventCode=${code}`, { revalidate: ttl(season) }),
    firstGet<{ schedule: FHybridMatch[] }>(`${season}/schedule/${code}/qual/hybrid`, { revalidate: rv }),
    firstGet<{ schedule: FHybridMatch[] }>(`${season}/schedule/${code}/playoff/hybrid`, { revalidate: rv }),
    optional(firstGet<{ matchScores: FMatchScore[] }>(`${season}/scores/${code}/qual`, { revalidate: rv })),
    optional(firstGet<{ matchScores: FMatchScore[] }>(`${season}/scores/${code}/playoff`, { revalidate: rv })),
    optional(getEventRankings(season, code, rv)),
    firstGet<{ alliances: FAlliance[] }>(`${season}/alliances/${code}`, { revalidate: rv }),
    firstGet<{ awards: FAward[] }>(`${season}/awards/${code}`, { revalidate: rv }),
    fetchEventTeamNames(season, code),
  ]);
  const d = detailR?.events?.[0];
  if (!d) return null;

  const schedule = [...(qualHybR?.schedule ?? []), ...(poHybR?.schedule ?? [])];
  for (const m of schedule)
    for (const t of m.teams)
      if (t.teamNumber != null && t.teamName && !names.has(t.teamNumber)) names.set(t.teamNumber, t.teamName);
  const matches = buildMatches(season, d.timezone, schedule, [
    ...(qs?.matchScores ?? []),
    ...(ps?.matchScores ?? []),
  ]);

  // Rank + roster → EventTeam list.
  const rankOf = new Map<number, number>();
  for (const r of rankR?.rankings ?? []) {
    rankOf.set(r.teamNumber, r.rank);
    if (r.teamName && !names.has(r.teamNumber)) names.set(r.teamNumber, r.teamName);
  }
  const teams: EventTeam[] = [...names.keys()].sort((a, b) => a - b).map((n) => ({
    teamNumber: n,
    team: { name: names.get(n) ?? `Team ${n}`, quickStats: null },
    stats: { rank: rankOf.get(n) ?? null, opr: null },
  }));

  const alliances: EventAlliance[] = (allianceR?.alliances ?? []).map((a) => ({
    number: a.number,
    captain: a.captain?.teamNumber ?? null,
    picks: [a.round1, a.round2, a.round3, a.backup]
      .map((p) => p?.teamNumber)
      .filter((x): x is number => x != null),
  }));

  const awards: EventAward[] = (awardR?.awards ?? []).map((a) => {
    const { type, placement } = mapAward(a.name, a.series);
    return { type, placement, teamNumber: a.teamNumber };
  });

  const t = now();
  const startMs = parse(d.dateStart, d.timezone);
  const endMs = parse(d.dateEnd ?? d.dateStart, d.timezone);
  const started = !Number.isNaN(startMs) && t >= startMs;
  const finished = !Number.isNaN(endMs) && t > endMs + 86400000;

  return {
    code: d.code,
    season,
    name: d.name ?? d.code,
    start: d.dateStart ?? "",
    end: d.dateEnd ?? d.dateStart ?? "",
    type: normalizeEventType(d.typeName, season),
    remote: d.remote,
    ongoing: isOngoing(d.dateStart, d.dateEnd, d.timezone),
    started,
    finished,
    timezone: d.timezone ?? "UTC",
    divisionCode: d.divisionCode,
    relatedEvents: [],
    location: { city: d.city, state: d.stateprov, country: d.country },
    website: d.website || null,
    liveStreamURL: d.liveStreamUrl || null,
    awards,
    alliances,
    teams,
    matches,
  };
}

/** One event's matches for the team page (quals + playoffs). Playoffs are absent
 *  until alliance selection, hence the tolerated nulls. */
export async function getEventMatches(
  season: number,
  code: string,
  timezone: string,
  eventEnd: string,
): Promise<Match[]> {
  const revalidate = teamPageRevalidate(season, eventEnd, timezone);
  const [qualHybR, playoffHybR, qs, ps] = await Promise.all([
    firstGet<{ schedule: FHybridMatch[] }>(`${season}/schedule/${code}/qual/hybrid`, { revalidate }),
    firstGet<{ schedule: FHybridMatch[] }>(`${season}/schedule/${code}/playoff/hybrid`, { revalidate }),
    optional(firstGet<{ matchScores: FMatchScore[] }>(`${season}/scores/${code}/qual`, { revalidate })),
    optional(firstGet<{ matchScores: FMatchScore[] }>(`${season}/scores/${code}/playoff`, { revalidate })),
  ]);
  return buildMatches(
    season,
    timezone,
    [...(qualHybR?.schedule ?? []), ...(playoffHybR?.schedule ?? [])],
    [...(qs?.matchScores ?? []), ...(ps?.matchScores ?? [])],
  );
}

/** A team's row in an event's qualification rankings. For a League Meet, FIRST's table
 *  is the whole league's so far, not that meet's. Null when it has no row yet. */
export async function getTeamEventRank(
  season: number,
  code: string,
  teamNumber: number,
  timezone: string,
  eventEnd: string,
): Promise<{ rank: number; rankingScore: number | null } | null> {
  const revalidate = teamPageRevalidate(season, eventEnd, timezone);
  const r = (await getEventRankings(season, code, revalidate))?.rankings?.find((x) => x.teamNumber === teamNumber);
  return r && r.rank > 0 ? { rank: r.rank, rankingScore: r.sortOrder1 } : null;
}

export interface WinLossRecord {
  wins: number;
  losses: number;
  ties: number;
}

/** A team's W-L-T over these matches. Uses FINAL scores (penalties included), which
 *  is what decides a match, rather than the no-penalty scores our rating store keeps.
 *  Surrogate matches don't count toward a team's record. */
export function recordOf(matches: Match[], teamNumber: number): WinLossRecord {
  const out: WinLossRecord = { wins: 0, losses: 0, ties: 0 };
  for (const m of matches) {
    const red = m.scores?.red?.totalPoints;
    const blue = m.scores?.blue?.totalPoints;
    if (red == null || blue == null) continue;
    const mine = m.teams.find((t) => t.teamNumber === teamNumber);
    if (!mine || mine.surrogate) continue;
    const my = mine.alliance === "Red" ? red : blue;
    const opp = mine.alliance === "Red" ? blue : red;
    if (my > opp) out.wins++;
    else if (my < opp) out.losses++;
    else out.ties++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SEASON SNAPSHOT / WORLD RECORD (from our precomputed store)
// ---------------------------------------------------------------------------
export async function getSeasonSnapshot(
  season: number,
): Promise<{ activeTeamsCount: number; matchesPlayedCount: number }> {
  const r = await siteMeta(season);
  return {
    activeTeamsCount: r?.v?.teamCount ?? 0,
    matchesPlayedCount: r?.v?.matchCount ?? 0,
  };
}

export interface WorldRecord {
  season: number;
  eventCode: string;
  eventName: string;
  eventStart: string;
  score: number;
  teams: { number: number; name: string }[];
}

export async function getWorldRecord(season: number): Promise<WorldRecord | null> {
  const wr = (await siteMeta(season))?.v?.worldRecord ?? null;
  if (!wr) return null;
  return {
    season,
    eventCode: wr.eventCode,
    eventName: wr.eventName ?? wr.eventCode,
    eventStart: wr.eventStart ?? "",
    score: wr.score,
    teams: wr.teams,
  };
}

// ---------------------------------------------------------------------------
// SEARCH (local index — FIRST has no fuzzy search endpoint)
// ---------------------------------------------------------------------------
function scoreMatch(hayName: string, needle: string, extra?: string): number {
  const n = hayName.toLowerCase();
  if (n === needle) return 0;
  if (extra && extra.toLowerCase() === needle) return 0;
  if (n.startsWith(needle)) return 1;
  if (extra && extra.toLowerCase().startsWith(needle)) return 1;
  const i = n.indexOf(needle);
  if (i >= 0) return 2 + i / 100;
  return Infinity;
}

/** All events for a season (metadata only), straight from FIRST. Unlike the
 *  precomputed store — which only holds events that already have matches — this
 *  includes UPCOMING events, so they stay searchable/importable before start. */
async function getSeasonEventList(season: number): Promise<EventSearchResult[]> {
  const r = await getSeasonEventsRaw(season);
  return (r?.events ?? []).map((e) => ({
    code: e.code,
    season,
    name: e.name ?? e.code,
    start: e.dateStart ?? "",
    type: normalizeEventType(e.typeName, season),
    location: { city: e.city, state: e.stateprov, country: e.country },
  }));
}

/** Every event in a season for the events index, including upcoming ones. */
export async function getEventIndex(season: number): Promise<EventIndexRow[]> {
  const r = await getSeasonEventsRaw(season);
  const t = now();
  // Old seasons have some junk codes ("63693260770.2649"), 209 of 2019's 1,130, that the
  // event page refuses. Same check as that page, which upper-cases first.
  return (r?.events ?? []).filter((e) => isValidEventCode(e.code.toUpperCase())).map((e) => {
    const start = (e.dateStart ?? "").slice(0, 10);
    const end = (e.dateEnd ?? e.dateStart ?? "").slice(0, 10);
    const today = venueToday(e.timezone, t);
    return {
      code: e.code,
      season,
      name: e.name ?? e.code,
      start: e.dateStart ?? "",
      end: e.dateEnd ?? e.dateStart ?? "",
      type: normalizeEventType(e.typeName, season),
      regionCode: e.regionCode || null,
      location: { city: e.city, state: e.stateprov, country: e.country },
      status: today < start ? "upcoming" : today > end ? "finished" : "today",
    };
  });
}

export async function searchAll(
  searchText: string,
  season: number,
): Promise<{ teams: TeamSearchResult[]; events: EventSearchResult[] }> {
  const q = searchText.trim().toLowerCase();
  if (!q) return { teams: [], events: [] };

  // Convex index-backed search (word-prefix) for teams + played events, merged
  // with FIRST's full season list so UPCOMING events (no matches yet, hence not
  // in our tables) stay searchable. Either source failing degrades gracefully.
  const r = await siteSearch(season, q);
  const teams: TeamSearchResult[] = (r?.v?.teams ?? []).map((t) => ({
    number: t.number,
    name: t.name,
    location: { city: null, state: t.region, country: null },
  }));
  const eventsByCode = new Map<string, EventSearchResult>();
  for (const e of r?.v?.events ?? []) {
    eventsByCode.set(e.code, {
      code: e.code,
      season,
      name: e.name ?? e.code,
      start: e.start ?? "",
      type: e.type,
      location: { city: e.city, state: e.state, country: e.country },
    });
  }
  try {
    for (const e of await getSeasonEventList(season)) {
      if (eventsByCode.has(e.code)) continue;
      if (Math.min(scoreMatch(e.name, q), scoreMatch(e.code, q)) !== Infinity) {
        eventsByCode.set(e.code, e);
      }
    }
  } catch {
    /* FIRST unavailable — Convex results only */
  }
  return { teams: teams.slice(0, 12), events: [...eventsByCode.values()].slice(0, 12) };
}
