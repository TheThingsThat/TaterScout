import { readFileSync } from "node:fs";
import path from "node:path";

// Compact stored point: [tMinutes, eventIdx, playoff, epaAuto, epaTele, oprAuto|null, oprTele|null]
type RawPoint = [number, number, number, number, number, number | null, number | null];

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

// Cache successful loads only (the file is large; re-parsing per request is slow).
const cache = new Map<number, FileShape>();

function load(season: number): FileShape | null {
  const c = cache.get(season);
  if (c) return c;
  try {
    const dir =
      process.env.VIBESCOUT_DATA_DIR || path.join(process.cwd(), "src", "data");
    const data = JSON.parse(
      readFileSync(path.join(dir, `trajectories-${season}.json`), "utf8"),
    ) as FileShape;
    cache.set(season, data);
    return data;
  } catch {
    return null;
  }
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function getTrajectory(season: number, team: number): Trajectory | null {
  const f = load(season);
  const raw = f?.teams[String(team)];
  if (!f || !raw || raw.length === 0) return null;

  const points: TrajPoint[] = raw.map((p, i) => {
    const ev = f.events[p[1]];
    const oa = p[5];
    const ot = p[6];
    return {
      i,
      time: f.t0 + p[0] * 60000,
      eventCode: ev?.c ?? "",
      eventName: ev?.n ?? null,
      playoff: p[2] === 1,
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
