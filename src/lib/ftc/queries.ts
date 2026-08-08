// Live data access for pages. Team/event detail come straight from the official
// FIRST Events API (first.ts); season snapshot, world record and search read our
// precomputed store (FIRST has no season-OPR or fuzzy-search endpoints).
import { firstGet } from "./first";
import { levelOf, normalizeEventType } from "./labels";
import { siteMeta, siteSearch } from "../data/convexSite";
import type {
  Team,
  TeamSearchResult,
  EventSearchResult,
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
  teamNumber: number;
  station: string;
  onField: boolean;
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
interface FScoreAlliance {
  alliance: "Red" | "Blue";
  autoPoints: number;
  teleopPoints: number;
  totalPoints: number;
}
interface FMatchScore {
  matchLevel: string;
  matchSeries: number;
  matchNumber: number;
  alliances: FScoreAlliance[];
}
interface FRanking {
  rank: number;
  teamNumber: number;
  teamName: string | null;
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

const now = () => Date.now();
const parse = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
/** An event is "ongoing" from its start date through the day after it ends. */
function isOngoing(start: string | null, end: string | null): boolean {
  const s = parse(start);
  const e = parse(end ?? start) + 86400000;
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
export async function getTeam(number: number, season: number): Promise<Team | null> {
  const [teamR, eventsR, awardsR] = await Promise.all([
    firstGet<{ teams: FTeam[] }>(`${season}/teams?teamNumber=${number}`, { revalidate: 3600 }),
    firstGet<{ events: FEvent[] }>(`${season}/events?teamNumber=${number}`, { revalidate: REVALIDATE }),
    firstGet<{ awards: FAward[] }>(`${season}/awards/${number}`, { revalidate: REVALIDATE }),
  ]);
  const t = teamR?.teams?.[0];
  if (!t) return null;

  const events: TeamEventLite[] = (eventsR?.events ?? []).map((e) => ({
    eventCode: e.code,
    event: {
      name: e.name ?? e.code,
      code: e.code,
      start: e.dateStart ?? "",
      type: normalizeEventType(e.typeName),
      ongoing: isOngoing(e.dateStart, e.dateEnd),
      timezone: e.timezone ?? "UTC",
      location: { city: e.city, state: e.stateprov, country: e.country },
    },
  }));
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
 * Is this a real event code for the season? Answered from FIRST's season list,
 * which is ONE cached fetch shared by every request (search uses it too), so a
 * legitimate page pays nothing extra.
 *
 * Without this gate, `/events/2025/<anything>` fans out to ~9 credentialed
 * FIRST calls before discovering the event doesn't exist — and since the data
 * cache keys on the code, every invented code is a fresh miss. That let an
 * anonymous visitor burn our single shared FIRST credential at 9x their own
 * request rate. Fails OPEN: if the list is unavailable we serve the page
 * rather than 404 real events over a transient upstream hiccup.
 */
async function isRealEventCode(season: number, code: string): Promise<boolean> {
  try {
    const list = await getSeasonEventList(season);
    if (list.length === 0) return true;
    const want = code.toUpperCase();
    return list.some((e) => e.code.toUpperCase() === want);
  } catch {
    return true;
  }
}

export async function getEvent(season: number, code: string): Promise<EventDetail | null> {
  if (!(await isRealEventCode(season, code))) return null;
  const [detailR, qualHybR, poHybR, qs, ps, rankR, allianceR, awardR, names] = await Promise.all([
    firstGet<{ events: FEvent[] }>(`${season}/events?eventCode=${code}`, { revalidate: REVALIDATE }),
    firstGet<{ schedule: FHybridMatch[] }>(`${season}/schedule/${code}/qual/hybrid`, { revalidate: REVALIDATE }),
    firstGet<{ schedule: FHybridMatch[] }>(`${season}/schedule/${code}/playoff/hybrid`, { revalidate: REVALIDATE }),
    firstGet<{ matchScores: FMatchScore[] }>(`${season}/scores/${code}/qual`, { revalidate: REVALIDATE }),
    firstGet<{ matchScores: FMatchScore[] }>(`${season}/scores/${code}/playoff`, { revalidate: REVALIDATE }),
    firstGet<{ rankings: FRanking[] }>(`${season}/rankings/${code}`, { revalidate: REVALIDATE }),
    firstGet<{ alliances: FAlliance[] }>(`${season}/alliances/${code}`, { revalidate: REVALIDATE }),
    firstGet<{ awards: FAward[] }>(`${season}/awards/${code}`, { revalidate: REVALIDATE }),
    fetchEventTeamNames(season, code),
  ]);
  const d = detailR?.events?.[0];
  if (!d) return null;

  // Scores keyed by level|series|number.
  const scoreByKey = new Map<string, { red?: FScoreAlliance; blue?: FScoreAlliance }>();
  for (const s of [...(qs?.matchScores ?? []), ...(ps?.matchScores ?? [])]) {
    const key = `${s.matchLevel}|${s.matchSeries}|${s.matchNumber}`;
    const e = scoreByKey.get(key) ?? {};
    for (const a of s.alliances) {
      if (a.alliance === "Red") e.red = a;
      else e.blue = a;
    }
    scoreByKey.set(key, e);
  }

  const matches: Match[] = [];
  for (const m of [...(qualHybR?.schedule ?? []), ...(poHybR?.schedule ?? [])]) {
    if (m.tournamentLevel === "PRACTICE") continue;
    const sc = scoreByKey.get(`${m.tournamentLevel}|${m.series}|${m.matchNumber}`);
    const played = !!m.postResultTime || !!(sc?.red && sc?.blue);
    const teams: MatchTeam[] = m.teams.map((t) => {
      if (t.teamName && !names.has(t.teamNumber)) names.set(t.teamNumber, t.teamName);
      return {
        teamNumber: t.teamNumber,
        alliance: t.station.startsWith("Red") ? "Red" : "Blue",
        station: t.station,
        allianceRole: null,
        surrogate: false,
        onField: t.onField,
      };
    });
    // No-penalty totals from the score breakdown when we have it, else the
    // hybrid's final-minus-foul.
    const redNp = sc?.red ? sc.red.autoPoints + sc.red.teleopPoints : (m.scoreRedFinal ?? 0) - (m.scoreRedFoul ?? 0);
    const blueNp = sc?.blue ? sc.blue.autoPoints + sc.blue.teleopPoints : (m.scoreBlueFinal ?? 0) - (m.scoreBlueFoul ?? 0);
    matches.push({
      matchNum: m.matchNumber,
      tournamentLevel: levelOf(m.tournamentLevel),
      series: m.series,
      hasBeenPlayed: played,
      scheduledStartTime: m.startTime,
      actualStartTime: m.actualStartTime,
      postResultTime: m.postResultTime,
      teams,
      scores: played
        ? {
            red: {
              totalPoints: sc?.red?.totalPoints ?? m.scoreRedFinal ?? 0,
              totalPointsNp: redNp,
              autoPoints: sc?.red?.autoPoints ?? m.scoreRedAuto,
            },
            blue: {
              totalPoints: sc?.blue?.totalPoints ?? m.scoreBlueFinal ?? 0,
              totalPointsNp: blueNp,
              autoPoints: sc?.blue?.autoPoints ?? m.scoreBlueAuto,
            },
          }
        : null,
    });
  }

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
  const started = !Number.isNaN(parse(d.dateStart)) && t >= parse(d.dateStart);
  const finished = !Number.isNaN(parse(d.dateEnd ?? d.dateStart)) && t > parse(d.dateEnd ?? d.dateStart) + 86400000;

  return {
    code: d.code,
    season,
    name: d.name ?? d.code,
    start: d.dateStart ?? "",
    end: d.dateEnd ?? d.dateStart ?? "",
    type: normalizeEventType(d.typeName),
    remote: d.remote,
    ongoing: isOngoing(d.dateStart, d.dateEnd),
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

/** Lightweight match list for an event (times + team numbers + final scores) —
 *  team-page use (next-match lookup and season W-L-T). */
export interface EventMatchLite {
  timezone: string;
  matches: {
    matchNum: number;
    tournamentLevel: string;
    series: number;
    hasBeenPlayed: boolean;
    scheduledStartTime: string | null;
    actualStartTime: string | null;
    redFinal: number | null;
    blueFinal: number | null;
    teams: { teamNumber: number; alliance: "Red" | "Blue" }[];
  }[];
}

export async function getEventMatches(
  season: number,
  code: string,
  knownTimezone?: string | null,
): Promise<EventMatchLite | null> {
  // Hybrid schedules: qual so the "next match" lookup sees UPCOMING (unplayed)
  // quals, playoff so the season record counts elim matches too. Playoff is
  // absent until alliance selection, hence the tolerated null. Callers that
  // already know the event's timezone (getTeam returns it) pass it to skip the
  // detail fetch — one fewer FIRST call per event.
  const [detailR, qualHybR, playoffHybR] = await Promise.all([
    knownTimezone == null
      ? firstGet<{ events: FEvent[] }>(`${season}/events?eventCode=${code}`, { revalidate: REVALIDATE })
      : null,
    firstGet<{ schedule: FHybridMatch[] }>(`${season}/schedule/${code}/qual/hybrid`, { revalidate: REVALIDATE }),
    firstGet<{ schedule: FHybridMatch[] }>(`${season}/schedule/${code}/playoff/hybrid`, { revalidate: REVALIDATE }),
  ]);
  const timezone = knownTimezone ?? detailR?.events?.[0]?.timezone;
  if (knownTimezone == null && !detailR?.events?.[0]) return null;
  return {
    timezone: timezone || "UTC",
    matches: [...(qualHybR?.schedule ?? []), ...(playoffHybR?.schedule ?? [])]
      .filter((m) => m.tournamentLevel !== "PRACTICE")
      .map((m) => ({
        matchNum: m.matchNumber,
        tournamentLevel: levelOf(m.tournamentLevel),
        series: m.series,
        // A posted score without postResultTime still means played — the event
        // page already treats it that way; diverging here made getSeasonRecord
        // drop such matches and let findNextMatch advertise them as upcoming.
        hasBeenPlayed:
          !!m.postResultTime || (m.scoreRedFinal != null && m.scoreBlueFinal != null),
        scheduledStartTime: m.startTime,
        actualStartTime: m.actualStartTime,
        redFinal: m.scoreRedFinal,
        blueFinal: m.scoreBlueFinal,
        teams: m.teams.map((t) => ({
          teamNumber: t.teamNumber,
          alliance: t.station.startsWith("Red") ? ("Red" as const) : ("Blue" as const),
        })),
      })),
  };
}

export interface SeasonRecord {
  wins: number;
  losses: number;
  ties: number;
}

/** A team's W-L-T across every match it played this season — quals AND playoffs.
 *  Uses FINAL scores (penalties included), which is what decides a match, rather
 *  than the no-penalty scores our rating store keeps. */
export async function getSeasonRecord(
  season: number,
  teamNumber: number,
  events: { code: string; timezone?: string | null }[],
): Promise<SeasonRecord> {
  const results = await Promise.all(
    events.map((e) => getEventMatches(season, e.code, e.timezone).catch(() => null)),
  );
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const res of results) {
    if (!res) continue;
    for (const m of res.matches) {
      if (!m.hasBeenPlayed || m.redFinal == null || m.blueFinal == null) continue;
      const mine = m.teams.find((t) => t.teamNumber === teamNumber);
      if (!mine) continue;
      const my = mine.alliance === "Red" ? m.redFinal : m.blueFinal;
      const opp = mine.alliance === "Red" ? m.blueFinal : m.redFinal;
      if (my > opp) wins++;
      else if (my < opp) losses++;
      else ties++;
    }
  }
  return { wins, losses, ties };
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
  const r = await firstGet<{ events: FEvent[] }>(`${season}/events`, { revalidate: REVALIDATE });
  return (r?.events ?? []).map((e) => ({
    code: e.code,
    season,
    name: e.name ?? e.code,
    start: e.dateStart ?? "",
    type: normalizeEventType(e.typeName),
    location: { city: e.city, state: e.stateprov, country: e.country },
  }));
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
