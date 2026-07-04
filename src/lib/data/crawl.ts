// Crawl + incremental delta detection from the official FIRST FTC Events API.
// One event = matches (all levels, one call) joined with the per-level score
// breakdowns (auto/teleop/RP). Team names + regions come from FIRST's teams
// endpoint. OPR is NOT provided by FIRST — we compute it in compute.ts.
import { firstGet } from "../ftc/first";
import { normalizeEventType } from "../ftc/labels";
import type { RawEvent, RawMatch } from "./types";

const CONCURRENCY = 6;

// --- FIRST response shapes (only the fields we use) ---
interface FirstEvent {
  code: string;
  name: string | null;
  typeName: string | null;
  regionCode: string | null;
  city: string | null;
  stateprov: string | null;
  country: string | null;
  dateStart: string | null;
  dateEnd: string | null;
}
interface FirstMatchTeam {
  teamNumber: number;
  station: string; // "Red1" | "Red2" | "Blue1" | "Blue2"
  onField: boolean;
}
interface FirstMatch {
  actualStartTime: string | null;
  scheduledStartTime?: string | null;
  postResultTime: string | null;
  tournamentLevel: string; // "PRACTICE" | "QUALIFICATION" | "PLAYOFF"
  series: number;
  matchNumber: number;
  teams: FirstMatchTeam[];
  modifiedOn?: string | null;
}
interface FirstAllianceScore {
  alliance: "Red" | "Blue";
  autoPoints: number;
  teleopPoints: number;
  movementRP: boolean;
  goalRP: boolean;
  patternRP: boolean;
}
interface FirstMatchScore {
  matchLevel: string;
  matchSeries: number;
  matchNumber: number;
  alliances: FirstAllianceScore[];
}
interface FirstTeam {
  teamNumber: number;
  nameShort: string | null;
  homeRegion: string | null;
}

// --- fetch helpers ---
const evOpts = { revalidate: undefined as number | undefined }; // crawl = no-store

const getEventsList = (season: number) =>
  firstGet<{ events: FirstEvent[] }>(`${season}/events`, evOpts);
const getEventDetail = (season: number, code: string) =>
  firstGet<{ events: FirstEvent[] }>(`${season}/events?eventCode=${code}`, evOpts);
const getMatches = (season: number, code: string) =>
  firstGet<{ matches: FirstMatch[] }>(`${season}/matches/${code}`, evOpts);
const getScores = (season: number, code: string, level: "qual" | "playoff") =>
  firstGet<{ matchScores: FirstMatchScore[] }>(`${season}/scores/${code}/${level}`, evOpts);

/** All teams (paginated) → name + homeRegion. */
async function fetchAllTeams(season: number): Promise<Map<number, { name: string; region: string | null }>> {
  const map = new Map<number, { name: string; region: string | null }>();
  let page = 1;
  let total = 1;
  do {
    const r = await firstGet<{ teams: FirstTeam[]; pageTotal: number }>(
      `${season}/teams?page=${page}`,
      evOpts,
    );
    for (const t of r?.teams ?? [])
      map.set(t.teamNumber, { name: t.nameShort ?? `Team ${t.teamNumber}`, region: t.homeRegion ?? null });
    total = r?.pageTotal ?? 1;
    page++;
  } while (page <= total);
  return map;
}

/** One event's team roster → name + homeRegion (paginated). */
async function fetchEventTeams(season: number, code: string): Promise<Map<number, { name: string; region: string | null }>> {
  const map = new Map<number, { name: string; region: string | null }>();
  let page = 1;
  let total = 1;
  do {
    const r = await firstGet<{ teams: FirstTeam[]; pageTotal: number }>(
      `${season}/teams?eventCode=${code}&page=${page}`,
      evOpts,
    );
    for (const t of r?.teams ?? [])
      map.set(t.teamNumber, { name: t.nameShort ?? `Team ${t.teamNumber}`, region: t.homeRegion ?? null });
    total = r?.pageTotal ?? 1;
    page++;
  } while (page <= total);
  return map;
}

const levelOf = (tournamentLevel: string) =>
  tournamentLevel === "QUALIFICATION" ? "Quals" : "Playoff";

/** Join matches + score breakdowns into RawMatch[] (played matches only). */
function buildRawEvent(
  detail: FirstEvent,
  matches: FirstMatch[],
  scores: FirstMatchScore[],
  teamInfo: Map<number, { name: string; region: string | null }>,
): RawEvent {
  // key: `${LEVEL}|${series}|${matchNumber}` -> per-alliance score
  const scoreByKey = new Map<string, { red?: FirstAllianceScore; blue?: FirstAllianceScore }>();
  for (const s of scores) {
    const key = `${s.matchLevel}|${s.matchSeries}|${s.matchNumber}`;
    const entry = scoreByKey.get(key) ?? {};
    for (const a of s.alliances) {
      if (a.alliance === "Red") entry.red = a;
      else if (a.alliance === "Blue") entry.blue = a;
    }
    scoreByKey.set(key, entry);
  }

  const out: RawMatch[] = [];
  let updatedAt: string | null = null;
  const teamNums = new Set<number>();

  const ordered = [...matches].sort(
    (a, b) => a.matchNumber - b.matchNumber || a.series - b.series,
  );
  for (const m of ordered) {
    if (m.tournamentLevel === "PRACTICE") continue;
    const sc = scoreByKey.get(`${m.tournamentLevel}|${m.series}|${m.matchNumber}`);
    if (!sc?.red || !sc?.blue) continue; // unplayed / no breakdown
    const time = Date.parse(m.actualStartTime ?? m.postResultTime ?? m.scheduledStartTime ?? "");
    if (Number.isNaN(time)) continue;
    const red = m.teams.filter((t) => t.onField && t.station.startsWith("Red")).map((t) => t.teamNumber);
    const blue = m.teams.filter((t) => t.onField && t.station.startsWith("Blue")).map((t) => t.teamNumber);
    if (!red.length || !blue.length) continue;
    for (const t of [...red, ...blue]) teamNums.add(t);
    if (m.modifiedOn && (!updatedAt || m.modifiedOn > updatedAt)) updatedAt = m.modifiedOn;
    out.push({
      key: `${detail.code}-${out.length}`,
      time,
      level: levelOf(m.tournamentLevel),
      num: m.matchNumber,
      series: m.series,
      red,
      blue,
      ra: sc.red.autoPoints,
      rt: sc.red.teleopPoints,
      ba: sc.blue.autoPoints,
      bt: sc.blue.teleopPoints,
      rrp: [sc.red.movementRP ? 1 : 0, sc.red.goalRP ? 1 : 0, sc.red.patternRP ? 1 : 0],
      brp: [sc.blue.movementRP ? 1 : 0, sc.blue.goalRP ? 1 : 0, sc.blue.patternRP ? 1 : 0],
    });
  }

  return {
    code: detail.code,
    name: detail.name,
    start: detail.dateStart,
    type: normalizeEventType(detail.typeName),
    updatedAt,
    city: detail.city,
    state: detail.stateprov,
    country: detail.country,
    matches: out,
    teams: [...teamNums].map((num) => ({
      num,
      name: teamInfo.get(num)?.name ?? `Team ${num}`,
      region: teamInfo.get(num)?.region ?? null,
    })),
  };
}

/** Fetch one event fully (self-contained; used by the refresh). */
export async function fetchEvent(season: number, code: string): Promise<RawEvent | null> {
  const [detailR, matchR, qs, ps, teamInfo] = await Promise.all([
    getEventDetail(season, code),
    getMatches(season, code),
    getScores(season, code, "qual"),
    getScores(season, code, "playoff"),
    fetchEventTeams(season, code),
  ]);
  const detail = detailR?.events?.[0];
  if (!detail) return null;
  const scores = [...(qs?.matchScores ?? []), ...(ps?.matchScores ?? [])];
  return buildRawEvent(detail, matchR?.matches ?? [], scores, teamInfo);
}

export async function fetchAllCodes(season: number): Promise<string[]> {
  const r = await getEventsList(season);
  return (r?.events ?? []).map((e) => e.code);
}

/** Full-season crawl. Uses one events list + a global team index, then 3 calls
 *  per event (matches + qual scores + playoff scores). */
export async function fetchAllEvents(
  season: number,
  onProgress?: (done: number, total: number) => void,
): Promise<RawEvent[]> {
  const [evR, teamIndex] = await Promise.all([getEventsList(season), fetchAllTeams(season)]);
  const details = evR?.events ?? [];
  const out: RawEvent[] = [];
  let done = 0;
  const queue = [...details];
  async function worker() {
    while (queue.length) {
      const d = queue.pop()!;
      try {
        const [matchR, qs, ps] = await Promise.all([
          getMatches(season, d.code),
          getScores(season, d.code, "qual"),
          getScores(season, d.code, "playoff"),
        ]);
        const scores = [...(qs?.matchScores ?? []), ...(ps?.matchScores ?? [])];
        const ev = buildRawEvent(d, matchR?.matches ?? [], scores, teamIndex);
        if (ev.matches.length) out.push(ev);
      } catch {
        /* skip a failed event */
      }
      done++;
      onProgress?.(done, details.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return out;
}

/** Recent/active events (overlapping now ± window). */
export async function fetchActiveWindow(
  season: number,
  lookbackDays = 14,
  lookaheadDays = 3,
): Promise<string[]> {
  const evR = await getEventsList(season);
  const now = Date.now();
  const lo = now - lookbackDays * 86400000;
  const hi = now + lookaheadDays * 86400000;
  return (evR?.events ?? [])
    .filter((e) => {
      const s = Date.parse(e.dateStart ?? "");
      const en = Date.parse(e.dateEnd ?? e.dateStart ?? "");
      return !Number.isNaN(s) && en >= lo && s <= hi;
    })
    .map((e) => e.code);
}

const natKey = (m: RawMatch) => `${m.level}|${m.series}|${m.num}`;

export interface DeltaResult {
  events: RawEvent[];
  changed: boolean;
  newEvents: string[];
  updatedEvents: string[];
  newMatches: number;
}

/** Re-ingest the active-window events (few) and merge; report only real changes. */
export async function fetchDeltas(season: number, current: RawEvent[]): Promise<DeltaResult> {
  const byCode = new Map(current.map((e) => [e.code, e]));
  const window = await fetchActiveWindow(season);

  const events = [...current];
  const newEvents: string[] = [];
  const updatedEvents: string[] = [];
  let newMatches = 0;

  for (const code of window) {
    let fresh: RawEvent | null = null;
    try {
      fresh = await fetchEvent(season, code);
    } catch {
      continue;
    }
    if (!fresh || !fresh.matches.length) continue;
    const old = byCode.get(code);
    const oldKeys = new Set((old?.matches ?? []).map(natKey));
    const added = fresh.matches.filter((m) => !oldKeys.has(natKey(m))).length;
    const changed =
      !old ||
      added > 0 ||
      old.matches.length !== fresh.matches.length ||
      (fresh.updatedAt ?? "") > (old.updatedAt ?? "");
    if (!changed) continue;
    newMatches += added;
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
