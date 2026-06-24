"use client";

import { useRef, useState } from "react";
import type { TrajPoint, EventSegment } from "@/lib/trajectory";

type Key = "epa" | "epaAuto" | "epaTele" | "opr" | "oprAuto" | "oprTele";

const SERIES: {
  key: Key;
  label: string;
  color: string;
  dash: string;
  width: number;
  group: "EPA" | "OPR";
}[] = [
  { key: "epa", label: "EPA Total", color: "var(--accent-2)", dash: "", width: 2.5, group: "EPA" },
  { key: "epaAuto", label: "EPA Auto", color: "var(--accent-2)", dash: "5 3", width: 1.5, group: "EPA" },
  { key: "epaTele", label: "EPA TeleOp", color: "var(--accent-2)", dash: "1.5 3", width: 1.5, group: "EPA" },
  { key: "opr", label: "OPR Total", color: "var(--accent)", dash: "", width: 2.5, group: "OPR" },
  { key: "oprAuto", label: "OPR Auto", color: "var(--accent)", dash: "5 3", width: 1.5, group: "OPR" },
  { key: "oprTele", label: "OPR TeleOp", color: "var(--accent)", dash: "1.5 3", width: 1.5, group: "OPR" },
];

const W = 1000;
const H = 420;
const PAD = { l: 40, r: 14, t: 14, b: 64 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function TrajectoryChart({
  points,
  segments,
}: {
  points: TrajPoint[];
  segments: EventSegment[];
}) {
  const [visible, setVisible] = useState<Set<Key>>(new Set(["epa", "opr"]));
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const n = points.length;
  const step = n > 1 ? PLOT_W / (n - 1) : 0;
  const xAt = (i: number) => (n > 1 ? PAD.l + i * step : PAD.l + PLOT_W / 2);

  // y-domain from visible series.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    for (const s of SERIES) {
      if (!visible.has(s.key)) continue;
      const v = p[s.key];
      if (v === null || v === undefined) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const padY = (hi - lo) * 0.08;
  lo -= padY;
  hi += padY;
  const yAt = (v: number) => PAD.t + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;

  // y gridlines (nice-ish round steps).
  const ticks: number[] = [];
  const span = hi - lo;
  const rawStep = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceStep = Math.ceil(rawStep / mag) * mag;
  for (let v = Math.ceil(lo / niceStep) * niceStep; v <= hi; v += niceStep)
    ticks.push(Math.round(v * 10) / 10);

  const halfStep = n > 1 ? step / 2 : PLOT_W / 2;

  function pathFor(key: Key): string {
    let d = "";
    let pen = false;
    for (let i = 0; i < n; i++) {
      const v = points[i][key];
      if (v === null || v === undefined) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)} `;
      pen = true;
    }
    return d;
  }

  function onMove(e: React.MouseEvent) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    let i = Math.round((sx - PAD.l) / (step || 1));
    i = Math.max(0, Math.min(n - 1, i));
    setHover(i);
  }

  function toggle(key: Key) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="card p-4">
      {/* Legend / toggles */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SERIES.map((s) => {
          const on = visible.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                on
                  ? "border-border bg-surface-2 text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              <svg width="16" height="6">
                <line
                  x1="0"
                  y1="3"
                  x2="16"
                  y2="3"
                  stroke={s.color}
                  strokeWidth={s.width}
                  strokeDasharray={s.dash}
                  opacity={on ? 1 : 0.4}
                />
              </svg>
              {s.label}
            </button>
          );
        })}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        style={{ touchAction: "none" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* event bands + playoff shading */}
        {segments.map((seg, idx) => {
          const left = Math.max(PAD.l, xAt(seg.start) - halfStep);
          const right = Math.min(W - PAD.r, xAt(seg.end) + halfStep);
          const mid = (left + right) / 2;
          return (
            <g key={`${seg.code}-${idx}`}>
              <rect
                x={left}
                y={PAD.t}
                width={Math.max(0, right - left)}
                height={PLOT_H}
                fill={idx % 2 ? "var(--surface-2)" : "transparent"}
                opacity={0.4}
              />
              <text
                x={mid}
                y={H - PAD.b + 16}
                textAnchor="middle"
                className="fill-muted"
                fontSize="10"
              >
                {seg.code}
              </text>
              <text
                x={mid}
                y={H - PAD.b + 28}
                textAnchor="middle"
                className="fill-muted"
                fontSize="9"
                opacity={0.7}
              >
                {fmtDate(points[seg.start].time)}
              </text>
            </g>
          );
        })}

        {/* playoff cells */}
        {points.map((p, i) =>
          p.playoff ? (
            <rect
              key={`po-${i}`}
              x={xAt(i) - halfStep}
              y={PAD.t}
              width={Math.max(1, step || halfStep * 2)}
              height={PLOT_H}
              fill="var(--gold)"
              opacity={0.1}
            />
          ) : null,
        )}

        {/* y gridlines */}
        {ticks.map((t) => (
          <g key={`t-${t}`}>
            <line
              x1={PAD.l}
              y1={yAt(t)}
              x2={W - PAD.r}
              y2={yAt(t)}
              stroke="var(--border)"
              strokeWidth="1"
              opacity={0.5}
            />
            <text
              x={PAD.l - 6}
              y={yAt(t) + 3}
              textAnchor="end"
              className="fill-muted"
              fontSize="10"
            >
              {t}
            </text>
          </g>
        ))}

        {/* series lines */}
        {SERIES.filter((s) => visible.has(s.key)).map((s) => (
          <path
            key={s.key}
            d={pathFor(s.key)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width}
            strokeDasharray={s.dash}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* hover guide + dots */}
        {hp && (
          <>
            <line
              x1={xAt(hp.i)}
              y1={PAD.t}
              x2={xAt(hp.i)}
              y2={PAD.t + PLOT_H}
              stroke="var(--foreground)"
              strokeWidth="1"
              opacity={0.3}
            />
            {SERIES.filter((s) => visible.has(s.key)).map((s) => {
              const v = hp[s.key];
              if (v === null || v === undefined) return null;
              return (
                <circle
                  key={s.key}
                  cx={xAt(hp.i)}
                  cy={yAt(v)}
                  r="3"
                  fill={s.color}
                />
              );
            })}
          </>
        )}
      </svg>

      {/* hover detail (HTML, below chart for reliable layout) */}
      <div className="mt-2 min-h-[2.5rem] text-xs">
        {hp ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium">
              Match {hp.i + 1}
              {hp.playoff && (
                <span className="ml-1 rounded bg-gold/15 px-1 text-gold">
                  playoff
                </span>
              )}
            </span>
            <span className="text-muted">
              {hp.eventName ?? hp.eventCode} · {fmtDate(hp.time)}
            </span>
            {SERIES.filter((s) => visible.has(s.key)).map((s) => {
              const v = hp[s.key];
              return (
                <span key={s.key} className="tabular-nums" style={{ color: s.color }}>
                  {s.label}: {v === null || v === undefined ? "—" : v}
                </span>
              );
            })}
          </div>
        ) : (
          <span className="text-muted">
            Hover the chart for per-match values. Shaded gold = playoff matches;
            grey bands group events.
          </span>
        )}
      </div>
    </div>
  );
}
