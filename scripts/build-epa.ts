/**
 * Precompute season rankings (EPA + OPR + region) from the FTCScout API and
 * write src/data/rankings-<season>.json for the app.
 *
 * Usage:  npx tsx scripts/build-epa.ts [season] [--refetch]
 *
 * Raw fetched data is cached at /tmp/vibescout-raw-<season>.json so re-running
 * the computation doesn't re-crawl the (rate-limited) API. Pass --refetch to
 * force a fresh crawl.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeEpa, type EpaMatch, type EpaTrajPoint } from "../src/lib/epa/engine.ts";
import { solveEventOpr, type AllianceObs, type Triple } from "../src/lib/epa/opr.ts";

const ENDPOINT = "https://api.ftcscout.org/graphql";
const SEASON = Number(process.argv[2]) || 2025;
const REFETCH = process.argv.includes("--refetch");
const CONCURRENCY = 10;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, `../src/data/rankings-${SEASON}.json`);
const TRAJ = resolve(__dirname, `../src/data/trajectories-${SEASON}.json`);
// v2 raw schema adds tournamentLevel + event name/start; old cache is ignored.
const RAW = `/tmp/vibescout-raw-${SEASON}-v2.json`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
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

interface RawMatch {
  key: string;
  time: number;
  level: string; // tournamentLevel ("Quals", "DoubleElim", "Finals", …)
  red: number[];
  blue: number[];
  ra: number; rt: number; // red auto, red teleop
  ba: number; bt: number;
}
interface RawEvent {
  code: string;
  name: string | null;
  start: string | null;
  region: string | null;
  matches: RawMatch[];
  teams: { num: number; name: string }[];
}

const EVENT_QUERY = `
  query Ev($season: Int!, $code: String!) {
    eventByCode(season: $season, code: $code) {
      name
      start
      teams { teamNumber team { name } }
      matches {
        hasBeenPlayed
        tournamentLevel
        actualStartTime
        scheduledStartTime
        teams { teamNumber alliance onField }
        scores {
          ... on MatchScores${SEASON} {
            red { autoPoints dcPoints }
            blue { autoPoints dcPoints }
          }
        }
      }
    }
  }
`;

interface RawMatchApi {
  hasBeenPlayed: boolean;
  tournamentLevel: string;
  actualStartTime: string | null;
  scheduledStartTime: string | null;
  teams: { teamNumber: number; alliance: string; onField: boolean }[];
  scores: {
    red?: { autoPoints: number; dcPoints: number };
    blue?: { autoPoints: number; dcPoints: number };
  } | null;
}

async function fetchAll(): Promise<RawEvent[]> {
  if (!REFETCH && existsSync(RAW)) {
    console.log(`[rank] using cached raw data ${RAW}`);
    return JSON.parse(readFileSync(RAW, "utf8")) as RawEvent[];
  }

  console.log(`[rank] season ${SEASON}: fetching event list…`);
  const { eventsSearch } = await gql<{
    eventsSearch: { code: string; regionCode: string | null }[];
  }>(
    `query($s: Int!){ eventsSearch(season: $s, hasMatches: true){ code regionCode } }`,
    { s: SEASON },
  );
  console.log(`[rank] ${eventsSearch.length} events. Fetching matches…`);

  const out: RawEvent[] = [];
  let done = 0;
  let skipped = 0;
  const t0 = Date.now();
  const queue = [...eventsSearch];

  async function worker() {
    while (queue.length) {
      const ev = queue.pop()!;
      try {
        const data = await gql<{
          eventByCode: {
            name: string | null;
            start: string | null;
            teams: { teamNumber: number; team: { name: string } }[];
            matches: RawMatchApi[];
          } | null;
        }>(EVENT_QUERY, { season: SEASON, code: ev.code });
        const e = data.eventByCode;
        if (e) {
          const matches: RawMatch[] = [];
          for (const m of e.matches) {
            if (!m.hasBeenPlayed || !m.scores?.red || !m.scores?.blue) continue;
            const time = Date.parse(m.actualStartTime ?? m.scheduledStartTime ?? "");
            if (Number.isNaN(time)) continue;
            const red = m.teams.filter((t) => t.alliance === "Red" && t.onField).map((t) => t.teamNumber);
            const blue = m.teams.filter((t) => t.alliance === "Blue" && t.onField).map((t) => t.teamNumber);
            if (!red.length || !blue.length) continue;
            matches.push({
              key: `${ev.code}-${matches.length}`,
              time, level: m.tournamentLevel, red, blue,
              ra: m.scores.red.autoPoints, rt: m.scores.red.dcPoints,
              ba: m.scores.blue.autoPoints, bt: m.scores.blue.dcPoints,
            });
          }
          out.push({
            code: ev.code,
            name: e.name,
            start: e.start,
            region: ev.regionCode,
            matches,
            teams: e.teams.map((t) => ({ num: t.teamNumber, name: t.team.name })),
          });
        }
      } catch {
        skipped++;
      }
      done++;
      if (done % 50 === 0 || done === eventsSearch.length) {
        const secs = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`[rank] ${done}/${eventsSearch.length} events · ${skipped} skipped · ${secs}s`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  writeFileSync(RAW, JSON.stringify(out));
  console.log(`[rank] cached raw → ${RAW}`);
  return out;
}

function rankBy<T>(items: T[], key: (t: T) => number | null): Map<T, number> {
  const ranked = items
    .filter((t) => key(t) !== null)
    .sort((a, b) => (key(b) as number) - (key(a) as number));
  const out = new Map<T, number>();
  ranked.forEach((t, i) => out.set(t, i + 1));
  return out;
}

async function main() {
  const events = await fetchAll();
  const matchCount = events.reduce((s, e) => s + e.matches.length, 0);
  console.log(`[rank] ${events.length} events · ${matchCount} matches`);

  // --- EPA (global chronological replay, with per-match trajectories) ---
  const epaMatches: EpaMatch[] = [];
  for (const e of events)
    for (const m of e.matches)
      epaMatches.push({
        time: m.time, redTeams: m.red, blueTeams: m.blue,
        redAuto: m.ra, redTeleop: m.rt, blueAuto: m.ba, blueTeleop: m.bt,
        eventCode: e.code, playoff: m.level !== "Quals", matchKey: m.key,
      });
  console.log(`[rank] computing EPA over ${epaMatches.length} matches…`);
  const epaTraj = new Map<number, EpaTrajPoint[]>();
  const { teams: epa } = computeEpa(epaMatches, {}, epaTraj);

  // --- OPR: season-average (for rankings) + cumulative-within-event (trajectory) ---
  console.log(`[rank] computing OPR per event…`);
  const oprSum = new Map<number, Triple>();
  const oprWt = new Map<number, number>();
  const oprAtMatch = new Map<string, Triple>(); // `${matchKey}|${team}` -> opr after that match
  for (const e of events) {
    const ms = [...e.matches].sort((a, b) => a.time - b.time);
    const obs: AllianceObs[] = [];
    const wt = new Map<number, number>();
    let lastSol = new Map<number, Triple>();
    for (const m of ms) {
      obs.push({ teams: m.red, v: [m.ra + m.rt, m.ra, m.rt] });
      obs.push({ teams: m.blue, v: [m.ba + m.bt, m.ba, m.bt] });
      for (const t of [...m.red, ...m.blue]) wt.set(t, (wt.get(t) ?? 0) + 1);
      lastSol = solveEventOpr(obs);
      for (const t of [...m.red, ...m.blue]) {
        const v = lastSol.get(t);
        if (v) oprAtMatch.set(`${m.key}|${t}`, v);
      }
    }
    for (const [team, v] of lastSol) {
      const w = wt.get(team) ?? 1;
      const cur = oprSum.get(team) ?? [0, 0, 0];
      oprSum.set(team, [cur[0] + v[0] * w, cur[1] + v[1] * w, cur[2] + v[2] * w]);
      oprWt.set(team, (oprWt.get(team) ?? 0) + w);
    }
  }

  // --- Names + region (mode of event regions a team appears in) ---
  const names = new Map<number, string>();
  const regionVotes = new Map<number, Map<string, number>>();
  for (const e of events) {
    for (const t of e.teams) if (!names.has(t.num)) names.set(t.num, t.name);
    if (e.region) {
      const present = new Set<number>();
      for (const m of e.matches) for (const t of [...m.red, ...m.blue]) present.add(t);
      for (const t of e.teams) present.add(t.num);
      for (const t of present) {
        const v = regionVotes.get(t) ?? new Map();
        v.set(e.region, (v.get(e.region) ?? 0) + 1);
        regionVotes.set(t, v);
      }
    }
  }
  const regionOf = (t: number): string | null => {
    const v = regionVotes.get(t);
    if (!v) return null;
    return [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  // --- Assemble per-team records ---
  interface Rec {
    number: number; name: string; region: string | null;
    oprNp: number | null; oprAuto: number | null; oprTele: number | null;
    epa: number | null; epaAuto: number | null; epaTele: number | null;
    n: number;
  }
  const allTeams = new Set<number>([...epa.keys(), ...oprWt.keys()]);
  const recs: Rec[] = [];
  for (const num of allTeams) {
    const w = oprWt.get(num);
    const os = oprSum.get(num);
    const opr = w && os ? ([os[0] / w, os[1] / w, os[2] / w] as Triple) : null;
    const e = epa.get(num);
    recs.push({
      number: num,
      name: names.get(num) ?? `Team ${num}`,
      region: regionOf(num),
      oprNp: opr ? round(opr[0]) : null,
      oprAuto: opr ? round(opr[1]) : null,
      oprTele: opr ? round(opr[2]) : null,
      epa: e ? round(e.epa) : null,
      epaAuto: e ? round(e.auto) : null,
      epaTele: e ? round(e.teleop) : null,
      n: e?.n ?? 0,
    });
  }

  // --- World ranks per metric ---
  const rankMaps = {
    oprNp: rankBy(recs, (r) => r.oprNp),
    oprAuto: rankBy(recs, (r) => r.oprAuto),
    oprTele: rankBy(recs, (r) => r.oprTele),
    epa: rankBy(recs, (r) => r.epa),
    epaAuto: rankBy(recs, (r) => r.epaAuto),
    epaTele: rankBy(recs, (r) => r.epaTele),
  };

  const teamsObj: Record<string, unknown> = {};
  for (const r of recs) {
    teamsObj[r.number] = {
      name: r.name, region: r.region, n: r.n,
      oprNp: r.oprNp, oprAuto: r.oprAuto, oprTele: r.oprTele,
      epa: r.epa, epaAuto: r.epaAuto, epaTele: r.epaTele,
      rkOprNp: rankMaps.oprNp.get(r) ?? null,
      rkOprAuto: rankMaps.oprAuto.get(r) ?? null,
      rkOprTele: rankMaps.oprTele.get(r) ?? null,
      rkEpa: rankMaps.epa.get(r) ?? null,
      rkEpaAuto: rankMaps.epaAuto.get(r) ?? null,
      rkEpaTele: rankMaps.epaTele.get(r) ?? null,
    };
  }

  const regions = [...new Set(recs.map((r) => r.region).filter(Boolean))].sort() as string[];

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    season: SEASON,
    computedAt: new Date().toISOString(),
    matchCount,
    teamCount: recs.length,
    regions,
    teams: teamsObj,
  }));
  console.log(`[rank] wrote ${OUT} · ${recs.length} teams · ${regions.length} regions`);

  // --- Trajectories file (compact arrays to keep it small) ---
  // Each point: [tMinutes, eventIdx, playoff, epaAuto, epaTele, oprAuto, oprTele]
  // EPA total = epaAuto + epaTele; OPR total = oprAuto + oprTele.
  const eventList: { c: string; n: string | null; s: string | null }[] = [];
  const eventIdx = new Map<string, number>();
  for (const e of events) {
    eventIdx.set(e.code, eventList.length);
    eventList.push({ c: e.code, n: e.name, s: e.start });
  }
  let tMin = Infinity;
  for (const pts of epaTraj.values())
    for (const p of pts) if (p.time < tMin) tMin = p.time;

  const r1 = (x: number) => Math.round(x * 10) / 10;
  const trajTeams: Record<string, unknown> = {};
  let pointCount = 0;
  for (const [team, pts] of epaTraj) {
    trajTeams[team] = pts.map((p) => {
      const o = oprAtMatch.get(`${p.matchKey}|${team}`);
      pointCount++;
      return [
        Math.round((p.time - tMin) / 60000),
        eventIdx.get(p.eventCode) ?? -1,
        p.playoff ? 1 : 0,
        r1(p.auto),
        r1(p.teleop),
        o ? r1(o[1]) : null,
        o ? r1(o[2]) : null,
      ];
    });
  }
  writeFileSync(
    TRAJ,
    JSON.stringify({ season: SEASON, t0: tMin, events: eventList, teams: trajTeams }),
  );
  console.log(`[rank] wrote ${TRAJ} · ${pointCount} match points`);

  const topEpa = recs.filter((r) => r.epa !== null).sort((a, b) => (b.epa as number) - (a.epa as number));
  console.log("[rank] top 8 by EPA:");
  for (const r of topEpa.slice(0, 8))
    console.log(`  #${r.number} ${r.name.slice(0, 18).padEnd(18)} EPA ${r.epa}  OPRnp ${r.oprNp}  [${r.region}]`);
}

const round = (x: number) => Math.round(x * 100) / 100;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
