// Pure recompute: RawEvent[] -> the three derived datasets the app reads.
// Lifted from scripts/build-epa.ts main() so the offline CLI and the runtime
// refresh route share one implementation. No network, no disk — caller supplies
// the events and handles fetch/persist.
import { computeEpa, type EpaMatch, type EpaTrajPoint } from "../epa/engine";
import { solveEventOpr, type AllianceObs, type Triple } from "../epa/opr";
import { computeSeasonCyclePriors } from "../predict/matchTimes";
import { computeSimModel, type SimMatch } from "../predict/model";
import type { ComputedData, RawEvent, TeamRow } from "./types";

const round = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;

function rankBy<T>(items: T[], key: (t: T) => number | null): Map<T, number> {
  const ranked = items
    .filter((t) => key(t) !== null)
    .sort((a, b) => (key(b) as number) - (key(a) as number));
  const out = new Map<T, number>();
  ranked.forEach((t, i) => out.set(t, i + 1));
  return out;
}

export function computeSeasonData(season: number, events: RawEvent[]): ComputedData {
  const matchCount = events.reduce((s, e) => s + e.matches.length, 0);

  // --- EPA (global chronological replay, with per-match trajectories) ---
  const epaMatches: EpaMatch[] = [];
  for (const e of events)
    for (const m of e.matches)
      epaMatches.push({
        time: m.time, redTeams: m.red, blueTeams: m.blue,
        redAuto: m.ra, redTeleop: m.rt, blueAuto: m.ba, blueTeleop: m.bt,
        eventCode: e.code, playoff: m.level !== "Quals", matchKey: m.key,
      });
  const epaTraj = new Map<number, EpaTrajPoint[]>();
  const { teams: epa, config: epaCfg } = computeEpa(epaMatches, {}, epaTraj);

  // --- OPR: season + per-event from FTCScout; per-match locally (trajectory) ---
  const eventFinalOpr = new Map<string, Map<number, Triple>>();
  const seasonOpr = new Map<number, Triple>(); // per-component max event OPR (= FTCScout quickStats)
  for (const e of events) {
    const evMap = new Map<number, Triple>();
    for (const t of e.teams) {
      if (!t.opr) continue;
      evMap.set(t.num, t.opr);
      const cur = seasonOpr.get(t.num);
      seasonOpr.set(
        t.num,
        cur
          ? [Math.max(cur[0], t.opr[0]), Math.max(cur[1], t.opr[1]), Math.max(cur[2], t.opr[2])]
          : t.opr,
      );
    }
    eventFinalOpr.set(e.code, evMap);
  }

  // Cumulative OPR after EVERY match (for the trajectory chart). No-shows kept.
  const oprAtMatch = new Map<string, Triple>();
  for (const e of events) {
    const ms = [...e.matches].sort((a, b) => a.time - b.time);
    const obs: AllianceObs[] = [];
    for (const m of ms) {
      obs.push({ teams: m.red, v: [m.ra + m.rt, m.ra, m.rt] });
      obs.push({ teams: m.blue, v: [m.ba + m.bt, m.ba, m.bt] });
      const sol = solveEventOpr(obs);
      for (const t of [...m.red, ...m.blue]) {
        const v = sol.get(t);
        if (v) oprAtMatch.set(`${m.key}|${t}`, v);
      }
    }
  }

  // No-show flags + real match numbers for the trajectory hover label.
  const noShowByKey = new Map<string, boolean>();
  const matchMeta = new Map<string, { num: number; series: number }>();
  for (const e of events)
    for (const m of e.matches) {
      if (m.red.length !== 2 || m.blue.length !== 2) noShowByKey.set(m.key, true);
      matchMeta.set(m.key, { num: m.num, series: m.series });
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
  const allTeams = new Set<number>([...epa.keys(), ...seasonOpr.keys()]);
  const recs: Rec[] = [];
  for (const num of allTeams) {
    const opr = seasonOpr.get(num) ?? null;
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

  const rankMaps = {
    oprNp: rankBy(recs, (r) => r.oprNp),
    oprAuto: rankBy(recs, (r) => r.oprAuto),
    oprTele: rankBy(recs, (r) => r.oprTele),
    epa: rankBy(recs, (r) => r.epa),
    epaAuto: rankBy(recs, (r) => r.epaAuto),
    epaTele: rankBy(recs, (r) => r.epaTele),
  };

  const teamsObj: Record<string, TeamRow> = {};
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

  // --- Season cycle priors (event type carried on each RawEvent) ---
  const cyclePriors = computeSeasonCyclePriors(
    events.map((e) => ({
      type: e.type || "Other",
      qualTimesMs: e.matches.filter((m) => m.level === "Quals").map((m) => m.time),
    })),
  );

  // --- Simulation model (win/score/RP calibration) ---
  const simMatches: SimMatch[] = [];
  for (const e of events)
    for (const m of e.matches)
      if (m.level === "Quals")
        simMatches.push({
          redTeams: m.red, blueTeams: m.blue,
          redNp: m.ra + m.rt, blueNp: m.ba + m.bt,
          redRp: m.rrp, blueRp: m.brp,
        });
  const simModel = computeSimModel(simMatches, (t) => epa.get(t)?.epa);

  // --- Trajectories (compact arrays) ---
  const eventList: { c: string; n: string | null; s: string | null }[] = [];
  const eventIdx = new Map<string, number>();
  for (const e of events) {
    eventIdx.set(e.code, eventList.length);
    eventList.push({ c: e.code, n: e.name, s: e.start });
  }
  let tMin = Infinity;
  for (const pts of epaTraj.values())
    for (const p of pts) if (p.time < tMin) tMin = p.time;
  if (!Number.isFinite(tMin)) tMin = 0;

  const trajTeams: Record<string, unknown> = {};
  for (const [team, pts] of epaTraj) {
    trajTeams[team] = pts.map((p) => {
      const o = oprAtMatch.get(`${p.matchKey}|${team}`);
      const meta = matchMeta.get(p.matchKey);
      return [
        Math.round((p.time - tMin) / 60000),
        eventIdx.get(p.eventCode) ?? -1,
        p.playoff ? 1 : 0,
        r1(p.auto),
        r1(p.teleop),
        o ? r1(o[1]) : null,
        o ? r1(o[2]) : null,
        noShowByKey.get(p.matchKey) ? 1 : 0,
        meta?.num ?? 0,
        meta?.series ?? 0,
      ];
    });
  }

  // --- Per-event time-aware snapshots (pre/post EPA + event OPR) ---
  const initTotal = epaCfg.baselineMeanTotal / 2;
  const initAuto = epaCfg.baselineMeanAuto / 2;
  const eventStats: Record<string, Record<string, (number | null)[]>> = {};
  for (const [team, pts] of epaTraj) {
    let prevTot = initTotal;
    let prevAuto = initAuto;
    let i = 0;
    while (i < pts.length) {
      const code = pts[i].eventCode;
      let j = i;
      while (j + 1 < pts.length && pts[j + 1].eventCode === code) j++;
      const last = pts[j];
      const o = eventFinalOpr.get(code)?.get(team);
      (eventStats[code] ??= {})[team] = [
        round(prevTot), round(prevAuto),
        round(last.epa), round(last.auto),
        o ? round(o[0]) : null,
        o ? round(o[1]) : null,
      ];
      prevTot = last.epa;
      prevAuto = last.auto;
      i = j + 1;
    }
  }

  return {
    rankings: {
      season,
      computedAt: new Date().toISOString(),
      matchCount,
      teamCount: recs.length,
      regions,
      cyclePriors,
      simModel,
      teams: teamsObj,
    },
    trajectories: {
      season,
      t0: tMin,
      events: eventList,
      teams: trajTeams as never,
    },
    eventStats: { season, events: eventStats },
  };
}
