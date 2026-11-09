// Crawl + incremental delta detection from the official FIRST FTC Events API.
// One event = matches (all levels, one call) joined with the per-level score
// breakdowns (auto/teleop/RP). Team names + regions come from FIRST's teams
// endpoint. OPR is NOT provided by FIRST — we compute it in compute.ts.
import { firstGet, firstGetConditional } from "../ftc/first";
import { levelOf, normalizeEventType } from "../ftc/labels";
import { isScored, teamsOnField, venueTimeMs } from "../ftc/match";
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
  timezone: string | null;
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
  // `score{X}Foul` is the penalty points X COMMITTED (credited to the other
  // alliance), so X's no-penalty score is its final minus the OPPONENT's foul.
  scoreRedFinal: number | null;
  scoreRedFoul: number | null;
  scoreRedAuto: number | null;
  scoreBlueFinal: number | null;
  scoreBlueFoul: number | null;
  scoreBlueAuto: number | null;
  teams: FirstMatchTeam[];
  modifiedOn?: string | null;
}
interface FirstAllianceScore {
  alliance: "Red" | "Blue";
  totalPoints?: number;
  // Ranking-point flags are GAME-SPECIFIC. A new season's read as undefined → 0
  // until they are added to rpFlags below.
  movementRP?: boolean; // DECODE 2025
  goalRP?: boolean;
  patternRP?: boolean;
  swarmRP?: boolean; // BIOBUZZ 2026
  pollinator1RP?: boolean;
  pollinator2RP?: boolean;
}
interface FirstMatchScore {
  matchLevel: string;
  matchSeries: number;
  matchNumber: number;
  alliances?: FirstAllianceScore[]; // absent on remote events' rows
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

/** One alliance's bonus ranking points as positional 0/1 flags. Empty means unknown:
 *  no score row yet, or a zeroed one (see below) whose flags would read as all-missed. */
const rpFlags = (a: FirstAllianceScore | undefined, allianceFinal: number | null): number[] =>
  !a || (a.totalPoints === 0 && (allianceFinal ?? 0) > 0)
    ? []
    : [a.movementRP ?? a.swarmRP, a.goalRP ?? a.pollinator1RP, a.patternRP ?? a.pollinator2RP].map(
        (earned) => (earned ? 1 : 0),
      );

const isPlayed = (m: FirstMatch): boolean =>
  m.tournamentLevel !== "PRACTICE" && isScored(m.scoreRedFinal, m.scoreBlueFinal);

/** Join matches + score breakdowns into RawMatch[] (played matches only). */
function buildRawEvent(
  season: number,
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
    for (const a of s.alliances ?? []) {
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
    if (!isPlayed(m)) continue;
    // Point totals come from the match row, not the per-game score breakdown:
    // FIRST serves the breakdown zeroed until a new season's score model ships
    // (BIOBUZZ's first events posted real finals with all-zero breakdowns), and
    // the two agree exactly once it does (checked on 2,850 DECODE alliance rows).
    const ra = m.scoreRedAuto ?? 0;
    const ba = m.scoreBlueAuto ?? 0;
    const rt = (m.scoreRedFinal ?? 0) - (m.scoreBlueFoul ?? 0) - ra;
    const bt = (m.scoreBlueFinal ?? 0) - (m.scoreRedFoul ?? 0) - ba;
    // A disqualified playoff alliance's final is zeroed with the opponent's fouls still
    // on the row, which makes its no-penalty score negative. No usable score to rate.
    if (rt + ra < 0 || bt + ba < 0) continue;
    const sc = scoreByKey.get(`${m.tournamentLevel}|${m.series}|${m.matchNumber}`);
    const tz = detail.timezone;
    const time =
      venueTimeMs(m.actualStartTime, tz) ??
      venueTimeMs(m.postResultTime, tz) ??
      venueTimeMs(m.scheduledStartTime, tz);
    if (time === null) continue;
    const red = teamsOnField(m.teams, "Red", m).map((t) => t.teamNumber);
    const blue = teamsOnField(m.teams, "Blue", m).map((t) => t.teamNumber);
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
      ra,
      rt,
      ba,
      bt,
      rrp: rpFlags(sc?.red, m.scoreRedFinal),
      brp: rpFlags(sc?.blue, m.scoreBlueFinal),
    });
  }

  return {
    code: detail.code,
    name: detail.name,
    start: detail.dateStart,
    type: normalizeEventType(detail.typeName, season),
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
        const ev = buildRawEvent(season, d, matchR?.matches ?? [], scores, teamIndex);
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

/** Events overlapping now ± window. `(0, 0)` = currently-ongoing events only
 *  (mirrors ftc-scout's Partial scope: start ≤ now ≤ end, counting the full end
 *  day). Larger windows also catch recently-finished / soon-starting events.
 *  Null when FIRST returned no list at all, which is not the same as no events. */
export async function fetchActiveWindow(
  season: number,
  lookbackDays = 14,
  lookaheadDays = 3,
): Promise<string[] | null> {
  const evR = await getEventsList(season);
  if (!evR) return null;
  const now = Date.now();
  const lo = now - lookbackDays * 86400000;
  const hi = now + lookaheadDays * 86400000;
  return (evR.events ?? [])
    .filter((e) => {
      const s = venueTimeMs(e.dateStart, e.timezone);
      const end = venueTimeMs(e.dateEnd ?? e.dateStart, e.timezone);
      // Count the whole final day: FIRST dates are midnight, so add ~1 day.
      return s !== null && end !== null && end + 86400000 >= lo && s <= hi;
    })
    .map((e) => e.code);
}

const natKey = (m: RawMatch) => `${m.level}|${m.series}|${m.num}`;

/** Run `fn` over `items`, CONCURRENCY at a time, starting nothing past `deadline`.
 *  Items left over simply wait for the next sync. */
async function pool<T>(items: T[], deadline: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length && Date.now() < deadline) await fn(queue.shift()!);
    }),
  );
}

export interface FreshnessToken {
  path: string;
  lastModified: string;
}

export interface ProbeResult {
  updates: { code: string; matches: FirstMatch[]; lastModified: string | null }[]; // events to re-ingest
  skipped304: number; // events skipped via If-Modified-Since
  failed: number; // events FIRST wouldn't serve this run (retried next sync)
  tokens: FreshnessToken[]; // Last-Modified values for events with nothing to ingest
}

/** The upstream gate (Statbotics pattern): each event's /matches call goes out
 *  with If-Modified-Since from `freshness`. This costs no Convex usage, so the
 *  caller only loads worker state when `updates` is non-empty. */
export async function probeEvents(
  season: number,
  window: string[],
  freshness: Record<string, string>,
  deadline: number,
): Promise<ProbeResult> {
  const out: ProbeResult = { updates: [], skipped304: 0, failed: 0, tokens: [] };
  await pool(window, deadline, async (code) => {
    try {
      const probe = await firstGetConditional<{ matches: FirstMatch[] }>(
        `${season}/matches/${code}`,
        freshness[`matches/${code}`],
      );
      if (probe.notModified) {
        out.skipped304++;
        return;
      }
      if (!probe.data) return; // 404 — no matches posted yet
      const matches = probe.data.matches ?? [];
      if (matches.some(isPlayed)) {
        out.updates.push({ code, matches, lastModified: probe.lastModified });
      } else if (probe.lastModified) {
        // Schedule only: nothing to ingest until FIRST modifies it again.
        out.tokens.push({ path: `matches/${code}`, lastModified: probe.lastModified });
      }
    } catch {
      out.failed++; // no token recorded, so the next sync probes it again
    }
  });
  return out;
}

export interface DeltaResult {
  events: RawEvent[];
  changed: boolean;
  newEvents: string[];
  updatedEvents: string[];
  newMatches: number;
  tokens: FreshnessToken[]; // fresh Last-Modified values to persist after the push
  unbuilt: number; // probed events with news that couldn't be read this run
}

/** Re-ingest the probed events and merge; report only real changes. The probe's
 *  matches body is REUSED for the build (no double fetch), and the existing
 *  modifiedOn/match-count comparison stays as the change backstop. A token is
 *  only returned once its event built, so a failed fetch gets retried. `force`
 *  takes every probed event as changed, picking up what that comparison can't see
 *  (RP flags and event details live outside /matches). */
export async function fetchDeltas(
  season: number,
  current: RawEvent[],
  probes: ProbeResult,
  deadline: number,
  force = false,
): Promise<DeltaResult> {
  const built: { code: string; fresh: RawEvent; lastModified: string | null }[] = [];
  await pool(probes.updates, deadline, async ({ code, matches, lastModified }) => {
    try {
      const [detailR, qs, ps, teamInfo] = await Promise.all([
        getEventDetail(season, code),
        getScores(season, code, "qual"),
        getScores(season, code, "playoff"),
        fetchEventTeams(season, code),
      ]);
      const detail = detailR?.events?.[0];
      if (!detail) return;
      const scores = [...(qs?.matchScores ?? []), ...(ps?.matchScores ?? [])];
      built.push({ code, fresh: buildRawEvent(season, detail, matches, scores, teamInfo), lastModified });
    } catch {
      /* no token recorded, so the next sync retries it */
    }
  });

  const byCode = new Map(current.map((e) => [e.code, e]));
  const events = [...current];
  const newEvents: string[] = [];
  const updatedEvents: string[] = [];
  const tokens = [...probes.tokens];
  let newMatches = 0;

  for (const { code, fresh, lastModified } of built) {
    if (lastModified) tokens.push({ path: `matches/${code}`, lastModified });
    if (!fresh.matches.length) continue;
    const old = byCode.get(code);
    const oldKeys = new Set((old?.matches ?? []).map(natKey));
    const added = fresh.matches.filter((m) => !oldKeys.has(natKey(m))).length;
    const changed =
      force ||
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
    tokens,
    unbuilt: probes.updates.length - built.length,
  };
}
