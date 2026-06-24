// FTCScout crawl + incremental "only new data" delta detection.
// Used by both the offline CLI (full crawl) and the runtime refresh route.
import type { RawEvent, RawMatch } from "./types";

const ENDPOINT = "https://api.ftcscout.org/graphql";
const CONCURRENCY = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plain fetch + 429 backoff; `no-store` so a refresh always sees fresh data. */
async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      });
      if (res.status === 429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      const json = await res.json();
      if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 200));
      return json.data as T;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

interface ApiAlliance {
  autoPoints: number; dcPoints: number;
  movementRp: number; goalRp: number; patternRp: number;
}
interface ApiMatch {
  hasBeenPlayed: boolean;
  tournamentLevel: string;
  matchNum: number;
  series: number;
  actualStartTime: string | null;
  scheduledStartTime: string | null;
  teams: { teamNumber: number; alliance: string; onField: boolean }[];
  scores: { red?: ApiAlliance; blue?: ApiAlliance } | null;
}
interface ApiEvent {
  name: string | null;
  start: string | null;
  type: string | null;
  regionCode: string | null;
  updatedAt: string | null;
  teams: {
    teamNumber: number;
    team: { name: string };
    stats: { opr: { totalPointsNp: number; autoPoints: number; dcPoints: number } } | null;
  }[];
  matches: ApiMatch[];
}

function eventQuery(season: number): string {
  return `
    query Ev($season: Int!, $code: String!) {
      eventByCode(season: $season, code: $code) {
        name
        start
        type
        regionCode
        updatedAt
        teams {
          teamNumber
          team { name }
          stats { ... on TeamEventStats${season} { opr { totalPointsNp autoPoints dcPoints } } }
        }
        matches {
          hasBeenPlayed
          tournamentLevel
          matchNum
          series
          actualStartTime
          scheduledStartTime
          teams { teamNumber alliance onField }
          scores {
            ... on MatchScores${season} {
              red { autoPoints dcPoints movementRp goalRp patternRp }
              blue { autoPoints dcPoints movementRp goalRp patternRp }
            }
          }
        }
      }
    }
  `;
}

/** Convert an FTCScout event payload into our RawEvent (filtering played matches). */
function toRawEvent(code: string, e: ApiEvent | null): RawEvent | null {
  if (!e) return null;
  const matches: RawMatch[] = [];
  for (const m of e.matches) {
    if (!m.hasBeenPlayed || !m.scores?.red || !m.scores?.blue) continue;
    const time = Date.parse(m.actualStartTime ?? m.scheduledStartTime ?? "");
    if (Number.isNaN(time)) continue;
    const red = m.teams.filter((t) => t.alliance === "Red" && t.onField).map((t) => t.teamNumber);
    const blue = m.teams.filter((t) => t.alliance === "Blue" && t.onField).map((t) => t.teamNumber);
    if (!red.length || !blue.length) continue;
    matches.push({
      key: `${code}-${matches.length}`,
      time, level: m.tournamentLevel, num: m.matchNum, series: m.series, red, blue,
      ra: m.scores.red.autoPoints, rt: m.scores.red.dcPoints,
      ba: m.scores.blue.autoPoints, bt: m.scores.blue.dcPoints,
      rrp: [m.scores.red.movementRp, m.scores.red.goalRp, m.scores.red.patternRp],
      brp: [m.scores.blue.movementRp, m.scores.blue.goalRp, m.scores.blue.patternRp],
    });
  }
  return {
    code,
    name: e.name,
    start: e.start,
    region: e.regionCode,
    type: e.type ?? "Other",
    updatedAt: e.updatedAt,
    matches,
    teams: e.teams.map((t) => ({
      num: t.teamNumber,
      name: t.team.name,
      opr: t.stats?.opr
        ? ([t.stats.opr.totalPointsNp, t.stats.opr.autoPoints, t.stats.opr.dcPoints] as [number, number, number])
        : null,
    })),
  };
}

/** Fetch one event fully. */
export async function fetchEvent(season: number, code: string): Promise<RawEvent | null> {
  const data = await gql<{ eventByCode: ApiEvent | null }>(eventQuery(season), { season, code });
  return toRawEvent(code, data.eventByCode);
}

/** All event codes (with matches) for a season — lightweight. */
export async function fetchAllCodes(season: number): Promise<string[]> {
  const { eventsSearch } = await gql<{ eventsSearch: { code: string }[] }>(
    `query($s: Int!){ eventsSearch(season: $s, hasMatches: true){ code } }`,
    { s: season },
  );
  return eventsSearch.map((e) => e.code);
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Events in the recent/active window, with their change watermark. */
export async function fetchActiveWindow(
  season: number,
  lookbackDays = 14,
  lookaheadDays = 3,
): Promise<{ code: string; updatedAt: string | null }[]> {
  const now = Date.now();
  const start = ymd(new Date(now - lookbackDays * 86400000));
  const end = ymd(new Date(now + lookaheadDays * 86400000));
  // hasMatches:true mirrors our ingest filter, so match-less (upcoming/empty)
  // events don't show up as spurious "new data".
  const { eventsSearch } = await gql<{ eventsSearch: { code: string; updatedAt: string | null }[] }>(
    `query($s: Int!, $st: Date, $e: Date){ eventsSearch(season: $s, start: $st, end: $e, hasMatches: true){ code updatedAt } }`,
    { s: season, st: start, e: end },
  );
  return eventsSearch;
}

/** Full crawl of a season (offline CLI). */
export async function fetchAllEvents(
  season: number,
  onProgress?: (done: number, total: number) => void,
): Promise<RawEvent[]> {
  const codes = await fetchAllCodes(season);
  const out: RawEvent[] = [];
  let done = 0;
  const queue = [...codes];
  async function worker() {
    while (queue.length) {
      const code = queue.pop()!;
      try {
        const ev = await fetchEvent(season, code);
        if (ev) out.push(ev);
      } catch {
        /* skip a failed event */
      }
      done++;
      onProgress?.(done, codes.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return out;
}

const natKey = (m: RawMatch) => `${m.level}|${m.series}|${m.num}`;

export interface DeltaResult {
  events: RawEvent[]; // merged set (current + new/updated)
  changed: boolean;
  newEvents: string[];
  updatedEvents: string[];
  newMatches: number;
}

/**
 * Cross-verify against what we already have and fetch ONLY new/changed data:
 *   - new events appearing in the active window (not in our set), and
 *   - existing events whose FTCScout `updatedAt` advanced past our watermark.
 * Returns the merged event set + a summary. No-op when nothing changed.
 */
export async function fetchDeltas(season: number, current: RawEvent[]): Promise<DeltaResult> {
  const byCode = new Map(current.map((e) => [e.code, e]));
  const window = await fetchActiveWindow(season);

  const newCodes: string[] = [];
  const dirtyCodes: string[] = [];
  for (const w of window) {
    const cur = byCode.get(w.code);
    if (!cur) newCodes.push(w.code);
    else if ((w.updatedAt ?? "") > (cur.updatedAt ?? "")) dirtyCodes.push(w.code);
  }

  const events = [...current];
  const newEvents: string[] = [];
  const updatedEvents: string[] = [];
  let newMatches = 0;

  for (const code of [...newCodes, ...dirtyCodes]) {
    const fresh = await fetchEvent(season, code);
    if (!fresh) continue;
    const old = byCode.get(code);
    const oldKeys = new Set((old?.matches ?? []).map(natKey));
    newMatches += fresh.matches.filter((m) => !oldKeys.has(natKey(m))).length;
    const idx = events.findIndex((e) => e.code === code);
    if (idx >= 0) {
      events[idx] = fresh;
      updatedEvents.push(code);
    } else {
      events.push(fresh);
      newEvents.push(code);
    }
  }

  return {
    events,
    changed: newEvents.length > 0 || updatedEvents.length > 0,
    newEvents,
    updatedEvents,
    newMatches,
  };
}
