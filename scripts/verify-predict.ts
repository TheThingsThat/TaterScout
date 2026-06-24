/**
 * Offline accuracy check for the match-time predictor.
 *
 * Usage:  npx tsx scripts/verify-predict.ts [season] [eventCode]
 *
 * Replays a finished event: at cutoffs of 25/50/75% of quals, treats later
 * quals as "unplayed", predicts their start times, and compares to the real
 * actual times. Reports mean/median error in minutes (TBA target ≈ 5 min).
 * If no eventCode is given, scans championships for a quals-heavy one.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  predictMatchTimes,
  FTC_DEFAULTS,
  type SchedMatch,
} from "../src/lib/predict/matchTimes.ts";

const ENDPOINT = "https://api.ftcscout.org/graphql";
const SEASON = Number(process.argv[2]) || 2025;
const CODE_ARG = process.argv[3];
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPriors(): { overallSec: number; byTypeSec: Record<string, number> } | null {
  try {
    const f = JSON.parse(
      readFileSync(resolve(__dirname, `../src/data/rankings-${SEASON}.json`), "utf8"),
    );
    return f.cyclePriors ?? null;
  } catch {
    return null;
  }
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
  return json.data as T;
}

interface RawMatch {
  matchNum: number;
  tournamentLevel: string;
  series: number;
  hasBeenPlayed: boolean;
  scheduledStartTime: string | null;
  actualStartTime: string | null;
}

async function fetchQuals(code: string): Promise<SchedMatch[]> {
  const data = await gql<{ eventByCode: { matches: RawMatch[] } | null }>(
    `query($s:Int!,$c:String!){ eventByCode(season:$s,code:$c){ matches {
        matchNum tournamentLevel series hasBeenPlayed scheduledStartTime actualStartTime } } }`,
    { s: SEASON, c: code },
  );
  const matches = data.eventByCode?.matches ?? [];
  return matches
    .filter((m) => m.tournamentLevel === "Quals")
    .map((m) => ({
      key: `Quals-${m.series}-${m.matchNum}`,
      scheduled: m.scheduledStartTime ? Date.parse(m.scheduledStartTime) : null,
      actual: m.actualStartTime ? Date.parse(m.actualStartTime) : null,
      played: m.hasBeenPlayed,
    }))
    .filter((m) => m.scheduled != null)
    .sort((a, b) => (a.scheduled as number) - (b.scheduled as number));
}

async function pickEvent(): Promise<string> {
  if (CODE_ARG) return CODE_ARG;
  const scanType = process.argv[4] || "Championship";
  const minQuals = scanType === "Championship" ? 40 : 24;
  console.log(`[verify] scanning ${SEASON} ${scanType} events for a quals-heavy one…`);
  const data = await gql<{ eventsSearch: { code: string }[] }>(
    `query($s:Int!){ eventsSearch(season:$s, hasMatches:true, type:${scanType}){ code } }`,
    { s: SEASON },
  );
  for (const e of (data.eventsSearch ?? []).slice(0, 60)) {
    const q = await fetchQuals(e.code);
    const usable = q.filter((m) => m.played && m.actual != null).length;
    if (usable >= minQuals) {
      console.log(`[verify] using ${e.code} (${usable} played quals)`);
      return e.code;
    }
  }
  throw new Error("no suitable event found; pass an event code explicitly");
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const code = await pickEvent();
  const quals = await fetchQuals(code);
  const playedReal = quals.filter((m) => m.played && m.actual != null);

  // Dynamic season prior (type-specific if available) vs the old fixed 330s.
  const priors = loadPriors();
  const evType = (
    await gql<{ eventByCode: { type: string } | null }>(
      `query($s:Int!,$c:String!){ eventByCode(season:$s,code:$c){ type } }`,
      { s: SEASON, c: code },
    )
  ).eventByCode?.type;
  const dynamicPrior =
    priors && evType && priors.byTypeSec[evType] != null
      ? priors.byTypeSec[evType]
      : (priors?.overallSec ?? 330);
  console.log(
    `[verify] ${code} (${evType}): ${quals.length} quals, ${playedReal.length} with real actual times`,
  );
  console.log(
    `[verify] season prior ${(dynamicPrior / 60).toFixed(2)}min (dynamic) vs 5.50min (old fixed)\n`,
  );

  for (const frac of [0.25, 0.5, 0.75]) {
    const cutoff = Math.floor(playedReal.length * frac);
    // Build the "live" snapshot: first `cutoff` quals known, the rest hidden.
    const snapshot: SchedMatch[] = quals.map((m, i) => {
      const known = i < cutoff && m.played && m.actual != null;
      return { key: m.key, scheduled: m.scheduled, actual: known ? m.actual : null, played: known };
    });
    // Evaluate the next-8 predictions (what the live UI shows) for a given prior.
    const evalPrior = (seasonPriorSec: number) => {
      const { predicted, idealCycleSec, weight } = predictMatchTimes(snapshot, {
        ...FTC_DEFAULTS,
        seasonPriorSec,
      });
      const errs: number[] = [];
      for (let i = cutoff; i < quals.length && i < cutoff + 8; i++) {
        const m = quals[i];
        if (m.actual == null) continue;
        const p = predicted.get(m.key);
        if (p == null) continue;
        errs.push(Math.abs(p - m.actual) / 60000);
      }
      const within5 = errs.filter((e) => e <= 5).length;
      const mean = errs.reduce((s, x) => s + x, 0) / (errs.length || 1);
      return {
        idealCycleSec,
        weight,
        str: `mean ${mean.toFixed(1)}m · median ${median(errs).toFixed(1)}m · within5 ${((within5 / (errs.length || 1)) * 100).toFixed(0)}%`,
      };
    };
    const dyn = evalPrior(dynamicPrior);
    const old = evalPrior(330);
    console.log(
      `cutoff ${(frac * 100).toFixed(0).padStart(2)}% (${cutoff} known · event-cycle weight ${dyn.weight.toFixed(2)} · blended ${(dyn.idealCycleSec / 60).toFixed(2)}min)\n` +
        `   next 8 dynamic prior: ${dyn.str}\n` +
        `   next 8 old fixed 330: ${old.str}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
