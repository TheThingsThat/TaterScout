import { getTrajectoriesData, ensureLoaded } from "@/lib/data/store";
import { convexBackendEnabled } from "@/lib/data/backend";
import { siteTrajectory } from "@/lib/data/convexSite";

// Compact stored point:
// [tMinutes, eventIdx, playoff, epaAuto, epaTele, oprAuto|null, oprTele|null, noShow?, matchNum?, series?]
type RawPoint = [number, number, number, number, number, number | null, number | null, number?, number?, number?];

interface FileShape {
  season: number;
  t0: number; // ms of first match
  events: { c: string; n: string | null; s: string | null }[];
  teams: Record<string, RawPoint[]>;
}

export interface TrajPoint {
  i: number; // sequence index
  time: number; // absolute ms
  eventCode: string;
  eventName: string | null;
  playoff: boolean;
  noShow: boolean; // a no-show/uneven match (an alliance lacked 2 robots)
  matchNum: number; // real competition match number (e.g. Q15 → 15)
  series: number; // playoff series (0 for quals)
  epa: number;
  epaAuto: number;
  epaTele: number;
  opr: number | null;
  oprAuto: number | null;
  oprTele: number | null;
}

export interface EventSegment {
  code: string;
  name: string | null;
  start: number; // first point index
  end: number; // last point index (inclusive)
  hasPlayoff: boolean;
}

export interface Trajectory {
  points: TrajPoint[];
  segments: EventSegment[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

// Shared transform: points reference `events` by index (global list for the
// file backend, per-team local list for the Convex doc — same code path).
function build(
  t0: number,
  events: { c: string; n: string | null; s: string | null }[],
  raw: RawPoint[],
): Trajectory | null {
  if (raw.length === 0) return null;
  const points: TrajPoint[] = raw.map((p, i) => {
    const ev = events[p[1]];
    const oa = p[5];
    const ot = p[6];
    return {
      i,
      time: t0 + p[0] * 60000,
      eventCode: ev?.c ?? "",
      eventName: ev?.n ?? null,
      playoff: p[2] === 1,
      noShow: p[7] === 1,
      matchNum: p[8] ?? 0,
      series: p[9] ?? 0,
      epaAuto: p[3],
      epaTele: p[4],
      epa: r1(p[3] + p[4]),
      oprAuto: oa,
      oprTele: ot,
      opr: oa !== null && ot !== null ? r1(oa + ot) : null,
    };
  });

  const segments: EventSegment[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const last = segments[segments.length - 1];
    if (last && last.code === p.eventCode) {
      last.end = i;
      last.hasPlayoff = last.hasPlayoff || p.playoff;
    } else {
      segments.push({
        code: p.eventCode,
        name: p.eventName,
        start: i,
        end: i,
        hasPlayoff: p.playoff,
      });
    }
  }
  return { points, segments };
}

export async function getTrajectory(season: number, team: number): Promise<Trajectory | null> {
  if (convexBackendEnabled()) {
    const r = await siteTrajectory(season, team);
    if (r) {
      if (!r.v) return null;
      return build(r.v.t0, r.v.events, r.v.points as RawPoint[]);
    }
  }
  await ensureLoaded(season);
  const f = getTrajectoriesData(season) as unknown as FileShape | null;
  const raw = f?.teams[String(team)];
  if (!f || !raw) return null;
  return build(f.t0, f.events, raw);
}
