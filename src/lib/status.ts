// System checks for the /status page. Probes run at most once per PROBE_TTL per
// server instance and are shared through the Vercel data cache, so an open status
// page costs Convex about two calls every two minutes; judging happens per request.
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { CURRENT_SEASON } from "./season";
import { siteMeta } from "./data/convexSite";
import { HOLD_MS } from "./data/refresh";
import { formatAgo } from "./format";

const PROBE_TTL_MS = 120_000;
const TIMEOUT_MS = 8_000;
const SLOW_MS = 2_000;
// Past this, a due sync that nobody started is reported. Syncs start on page views,
// so a quiet night can trip it until the next visit (this page is one).
const OVERDUE_MS = 30 * 60_000;
const FIRST_BASE = "https://ftc-api.firstinspires.org/v2.0";

export type Level = "ok" | "degraded" | "down" | "info";

export interface SyncState {
  lastSyncAt: number; // last run that finished
  nextCheckAt: number;
  lastChangedAt: number; // match data last changed
  lastRankSyncAt: number;
  lastAttemptAt: number | null; // last run that started
  failedRuns: number; // runs in a row that started but never finished
  lastEventsChecked: number;
  lastReadFailures: number;
}

/** Raw probe results, cached and shared. Never throws. */
export interface Probes {
  checkedAt: number;
  database: { ok: boolean; ms: number | null };
  sync: SyncState | null;
  signIn: { ok: boolean; ms: number | null };
  first: {
    reachable: boolean; // the unauthenticated index answered
    ms: number | null;
    status: string | null; // FIRST's own status field, "normal" when healthy
    currentSeason: number | null;
    configured: boolean; // credentials present on this deployment
    dataStatus: number | null; // HTTP status of the credentialed call; null = no answer
  };
}

const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
  ]);

/** Runs `fn` with a timeout, once more if the first try looks bad, so one dropped
 *  request doesn't get cached as an outage for every visitor. */
async function attempt<T>(fn: () => Promise<T>, bad: (v: T) => boolean): Promise<{ v: T | null; ms: number | null }> {
  let last: { v: T | null; ms: number | null } = { v: null, ms: null };
  for (let i = 0; i < 2; i++) {
    const t = Date.now();
    try {
      const v = await withTimeout(fn());
      last = { v, ms: Date.now() - t };
      if (!bad(v)) return last;
    } catch {
      last = { v: null, ms: null };
    }
  }
  return last;
}

const getJson = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, body: res.ok ? ((await res.json()) as Record<string, unknown>) : null };
};
const notOk = (r: { body: unknown }) => r.body === null;

async function probe(): Promise<Probes> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const siteUrl =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
  const user = process.env.FIRST_API_USER;
  const token = process.env.FIRST_API_TOKEN;

  const [state, jwks, index, data] = await Promise.all([
    attempt(() => fetchQuery(api.sync.state.get, { season: CURRENT_SEASON }, { url: convexUrl }), () => false),
    // Convex Auth serves its signing keys from the deployment; scouting sign-in needs them.
    attempt(() => getJson(`${siteUrl}/.well-known/jwks.json`), notOk),
    // FIRST's index needs no credentials and reports the API's own status.
    attempt(() => getJson(`${FIRST_BASE}/`), notOk),
    // The season summary needs them, so it catches an expired or rate-limited token.
    // A rejection isn't retried: it won't change, and retrying spends the credential.
    user && token
      ? attempt(
          () =>
            getJson(`${FIRST_BASE}/${CURRENT_SEASON}`, {
              Authorization: "Basic " + btoa(`${user}:${token}`),
              Accept: "application/json",
            }),
          (r) => r.status === 429 || r.status >= 500,
        )
      : Promise.resolve(null),
  ]);

  const s = state.v;
  const keys = jwks.v?.body?.keys;
  const body = index.v?.body;
  return {
    checkedAt: Date.now(),
    database: { ok: s !== null, ms: state.ms },
    sync: s
      ? {
          lastSyncAt: s.lastSyncAt,
          nextCheckAt: s.nextCheckAt,
          lastChangedAt: s.lastChangedAt,
          lastRankSyncAt: s.lastRankSyncAt,
          // Absent until the Convex side of this page is deployed.
          lastAttemptAt: ("lastAttemptAt" in s ? s.lastAttemptAt : undefined) ?? null,
          failedRuns: ("failedRuns" in s ? s.failedRuns : undefined) ?? 0,
          lastEventsChecked: ("lastEventsChecked" in s ? s.lastEventsChecked : undefined) ?? 0,
          lastReadFailures: ("lastReadFailures" in s ? s.lastReadFailures : undefined) ?? 0,
        }
      : null,
    signIn: { ok: Array.isArray(keys) && keys.length > 0, ms: jwks.ms },
    first: {
      reachable: body != null,
      ms: index.ms,
      status: typeof body?.status === "string" ? body.status : null,
      currentSeason: typeof body?.currentSeason === "number" ? body.currentSeason : null,
      configured: data !== null,
      dataStatus: data?.v?.status ?? null,
    },
  };
}

// One probe at a time per instance, and none while the last is younger than the TTL:
// the shared cache alone lets every request that finds it stale start its own.
let inflight: Promise<Probes> | null = null;
let latest: Probes | null = null;
function probeOnce(): Promise<Probes> {
  if (latest && Date.now() - latest.checkedAt < PROBE_TTL_MS) return Promise.resolve(latest);
  inflight ??= probe()
    .then((p) => (latest = p))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const cachedProbes = unstable_cache(probeOnce, ["system-status"], { revalidate: PROBE_TTL_MS / 1000 });

export interface Check {
  name: string;
  level: Level;
  summary: string;
}

export interface SeasonTotals {
  teamCount: number;
  matchCount: number;
}

const speed = (ms: number | null) => (ms === null ? "" : ` in ${ms} ms`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function firstCheck(f: Probes["first"]): Check {
  const name = "FIRST Events API";
  const pages = "live scores, schedules and team pages can't load";
  if (!f.reachable) return { name, level: "down", summary: `FIRST isn't responding: ${pages}.` };
  if (!f.configured) return { name, level: "down", summary: `FIRST API credentials aren't set on this deployment: ${pages}.` };
  const code = f.dataStatus;
  if (code === 401 || code === 403) return { name, level: "down", summary: `FIRST rejected our API credentials: ${pages}.` };
  if (code === 429)
    return { name, level: "degraded", summary: "FIRST is rate-limiting our requests: live pages may load slowly or fail." };
  if (code === null) return { name, level: "down", summary: `FIRST's data requests aren't answering: ${pages}.` };
  if (code >= 500) return { name, level: "down", summary: `FIRST's data requests are failing (HTTP ${code}): ${pages}.` };
  if (code >= 300) return { name, level: "degraded", summary: `FIRST gave an unexpected answer (HTTP ${code}).` };
  if (f.status && f.status !== "normal")
    return { name, level: "degraded", summary: `FIRST reports its status as "${f.status}".` };
  if (f.currentSeason !== null && f.currentSeason > CURRENT_SEASON)
    return {
      name,
      level: "degraded",
      summary: `FIRST has started the ${f.currentSeason} season; this site still shows ${CURRENT_SEASON}.`,
    };
  return { name, level: "ok", summary: `Responding normally${speed(f.ms)}.` };
}

function syncCheck(s: SyncState | null, checkedAt: number, now: number, syncEnabled: boolean): Check {
  const name = "Sync worker";
  if (!s) return { name, level: "down", summary: "Can't read the sync state." };
  if (!syncEnabled) return { name, level: "info", summary: "Automatic sync runs only on the production site." };

  const started = s.lastAttemptAt !== null && s.lastAttemptAt > s.lastSyncAt;
  const running = started && checkedAt - s.lastAttemptAt! < HOLD_MS;
  // Runs already counted, plus the latest one if it is over without finishing.
  const failed = s.failedRuns + (started && !running ? 1 : 0);
  const now_ = running ? " Another is running now." : " The next page view retries.";

  if (s.lastSyncAt === 0)
    return running
      ? { name, level: "ok", summary: "This season's first sync is running." }
      : { name, level: "degraded", summary: "No sync has finished this season yet." };
  if (failed > 0)
    return {
      name,
      level: "degraded",
      summary: `${failed === 1 ? "The last sync" : `The last ${failed} syncs`} didn't finish. The last one that did was ${formatAgo(s.lastSyncAt, now)}.${now_}`,
    };
  if (!running && checkedAt - s.nextCheckAt > OVERDUE_MS)
    return {
      name,
      level: "degraded",
      summary: `A sync has been due since ${formatAgo(s.nextCheckAt, now)} and none has started. Syncs start when someone visits, and this visit has asked for one, so this should clear within a few minutes. If it doesn't, syncs are failing before they start.`,
    };
  if (s.lastEventsChecked > 0 && s.lastReadFailures >= s.lastEventsChecked)
    return {
      name,
      level: "degraded",
      summary: `The last sync couldn't read any of the ${plural(s.lastEventsChecked, "active event", "active events")} from FIRST. It retries shortly.`,
    };

  const partial =
    s.lastReadFailures > 0
      ? ` ${s.lastReadFailures} of ${s.lastEventsChecked} active events couldn't be read and retry shortly.`
      : "";
  const next = running
    ? " A sync is running now."
    : ` Next check ${now >= s.nextCheckAt ? "runs on the next page view" : formatAgo(s.nextCheckAt, now)}.`;
  return { name, level: "ok", summary: `Last sync finished ${formatAgo(s.lastSyncAt, now)}.${next}${partial}` };
}

/** Judge the probes as of `now`. `seasonData` is null when it couldn't be read and
 *  undefined when the season has none yet; `syncEnabled` is false off production. */
export function evaluate(
  p: Probes,
  seasonData: SeasonTotals | null | undefined,
  now: number,
  syncEnabled: boolean,
): Check[] {
  return [
    { name: "Website", level: "ok", summary: "Serving pages." },
    !p.database.ok
      ? { name: "Database", level: "down", summary: "Can't reach the database: rankings, team stats and scouting are unavailable." }
      : {
          name: "Database",
          level: (p.database.ms ?? 0) > SLOW_MS ? "degraded" : "ok",
          summary: `Responding${speed(p.database.ms)}.`,
        },
    seasonData === null
      ? { name: "Season data", level: "down", summary: "Couldn't read this season's ratings." }
      : !seasonData || seasonData.teamCount === 0
        ? // Normal before a season's first matches; a read failure is the case above.
          { name: "Season data", level: "info", summary: "No rated matches for this season yet." }
        : {
            name: "Season data",
            level: "ok",
            summary: `${seasonData.teamCount.toLocaleString()} teams rated from ${seasonData.matchCount.toLocaleString()} matches.`,
          },
    p.signIn.ok
      ? { name: "Scouting sign-in", level: "ok", summary: `Sign-in service responding${speed(p.signIn.ms)}.` }
      : { name: "Scouting sign-in", level: "down", summary: "The sign-in service isn't responding; scouts can't sign in." },
    firstCheck(p.first),
    syncCheck(p.sync, p.checkedAt, now, syncEnabled),
  ];
}

const RANK: Record<Level, number> = { info: 0, ok: 1, degraded: 2, down: 3 };

export function overall(checks: Check[]): Level {
  return checks.reduce<Level>((worst, c) => (RANK[c.level] > RANK[worst] ? c.level : worst), "ok");
}

/** Everything the status page shows, judged as of this request. */
export async function loadStatus() {
  const [cached, meta] = await Promise.all([cachedProbes(), siteMeta(CURRENT_SEASON)]);
  // The shared cache serves a stale entry first and refreshes behind it; after an idle
  // stretch that entry could be hours old, so don't judge from it.
  const probes = Date.now() - cached.checkedAt > 2 * PROBE_TTL_MS ? await probeOnce() : cached;
  const now = Date.now();
  const season = meta === null ? null : (meta.v ?? undefined);
  const checks = evaluate(probes, season, now, process.env.VERCEL_ENV === "production");
  return { probes, season, now, checks, level: overall(checks) };
}
