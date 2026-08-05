import { getEventStatsData, ensureLoaded } from "@/lib/data/store";
import { convexBackendEnabled } from "@/lib/data/backend";
import { siteEventStats } from "@/lib/data/convexSite";

// Per-event, time-aware team ratings precomputed by scripts/build-epa.ts.
// Compact stored row: [preTot, preAuto, postTot, postAuto, oprNp, oprAuto]
//   pre*  = EPA the team carried INTO the event (unbiased — seeds simulations)
//   post* = EPA the team left the event with (shown on the event page)
//   opr*  = that event's OPR (no-penalty); tele = np − auto
type Row = (number | null)[];

interface FileShape {
  season: number;
  events: Record<string, Record<string, Row>>;
}

export interface EventTeamStat {
  preEpa: number;
  preEpaAuto: number;
  preEpaTele: number;
  epa: number; // post-event
  epaAuto: number;
  epaTele: number;
  oprNp: number | null;
  oprAuto: number | null;
  oprTele: number | null;
}

function rowsToMap(rows: Record<string, Row>): Map<number, EventTeamStat> {
  const out = new Map<number, EventTeamStat>();
  for (const [team, r] of Object.entries(rows)) {
    const preT = r[0] ?? 0;
    const preA = r[1] ?? 0;
    const postT = r[2] ?? 0;
    const postA = r[3] ?? 0;
    const oprNp = r[4];
    const oprA = r[5];
    out.set(Number(team), {
      preEpa: preT,
      preEpaAuto: preA,
      preEpaTele: preT - preA,
      epa: postT,
      epaAuto: postA,
      epaTele: postT - postA,
      oprNp,
      oprAuto: oprA,
      oprTele: oprNp != null && oprA != null ? oprNp - oprA : null,
    });
  }
  return out;
}

/** Time-aware per-team ratings for one event, keyed by team number. Empty when
 *  the event isn't in the precomputed data (e.g. live/unfinished). */
export async function getEventStats(
  season: number,
  code: string,
): Promise<Map<number, EventTeamStat>> {
  if (convexBackendEnabled()) {
    const r = await siteEventStats(season, code);
    if (r) return r.v ? rowsToMap(r.v.rows) : new Map();
  }
  await ensureLoaded(season);
  const ev = (getEventStatsData(season) as unknown as FileShape | null)?.events[code];
  return ev ? rowsToMap(ev) : new Map();
}
