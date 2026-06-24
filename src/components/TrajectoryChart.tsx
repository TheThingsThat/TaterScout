"use client";

import { useRef, useState } from "react";
import type { TrajPoint, EventSegment } from "@/lib/trajectory";

type Key = "epa" | "epaAuto" | "epaTele" | "opr" | "oprAuto" | "oprTele";

const EPA = "#2f8bff";
const OPR = "#3ecf76";

const SERIES: {
  key: Key;
  label: string;
  color: string;
  dash: string;
  width: number;
}[] = [
  { key: "epa", label: "EPA Total", color: EPA, dash: "", width: 2.5 },
  { key: "epaAuto", label: "EPA Auto", color: EPA, dash: "5 3", width: 1.5 },
  { key: "epaTele", label: "EPA TeleOp", color: EPA, dash: "1.5 3", width: 1.5 },
  { key: "opr", label: "OPR Total", color: OPR, dash: "", width: 2.5 },
  { key: "oprAuto", label: "OPR Auto", color: OPR, dash: "5 3", width: 1.5 },
  { key: "oprTele", label: "OPR TeleOp", color: OPR, dash: "1.5 3", width: 1.5 },
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

/** Real competition match label (e.g. "Qual 15", "Match 1-2"). Falls back to
 *  the season sequence index for points without match metadata. */
function matchLabel(p: TrajPoint): string {
  if (!p.matchNum) return `Match ${p.i + 1}`;
  if (!p.playoff) return `Qual ${p.matchNum}`;
  if (p.series > 0) return `Match ${p.series}-${p.matchNum}`;
  return `Match ${p.matchNum}`;
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

  const ticks: number[] = [];
  for (let k = 0; k <= 3; k++) {
    ticks.push(Math.round((lo + ((hi - lo) * k) / 3) * 10) / 10);
  }

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
    <div className="rounded-2xl border border-[#1a1a1a] bg-surface p-[18px]">
      <div className="mb-3.5 flex flex-wrap gap-2">
        {SERIES.map((s) => {
          const on = visible.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className="flex items-center gap-1.5 rounded-lg px-[9px] py-[5px] text-[11px] transition-colors"
              style={
                on
                  ? { background: "#161616", border: "1px solid #262626", color: "#f4f5f7" }
                  : { background: "transparent", border: "1px solid transparent", color: "#6b6f78" }
              }
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
        className="block w-full select-none"
        style={{ touchAction: "none" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
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
                fill={idx % 2 ? "rgba(255,255,255,0.03)" : "transparent"}
              />
              <text x={mid} y={H - PAD.b + 20} textAnchor="middle" fill="#6b6f78" fontSize="11" fontFamily="var(--font-spacemono), monospace">
                {seg.code}
              </text>
              <text x={mid} y={H - PAD.b + 34} textAnchor="middle" fill="#52565e" fontSize="10" fontFamily="var(--font-spacemono), monospace">
                {fmtDate(points[seg.start].time)}
              </text>
            </g>
          );
        })}

        {points.map((p, i) =>
          p.playoff ? (
            <rect
              key={`po-${i}`}
              x={xAt(i) - halfStep}
              y={PAD.t}
              width={Math.max(1, step || halfStep * 2)}
              height={PLOT_H}
              fill="var(--gold)"
              opacity={0.08}
            />
          ) : null,
        )}

        {ticks.map((t) => (
          <g key={`t-${t}`}>
            <line x1={PAD.l} y1={yAt(t)} x2={W - PAD.r} y2={yAt(t)} stroke="#1f1f1f" strokeWidth="1" />
            <text x={PAD.l - 6} y={yAt(t) + 3} textAnchor="end" fill="#52565e" fontSize="10" fontFamily="var(--font-spacemono), monospace">
              {t}
            </text>
          </g>
        ))}

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

        {hp && (
          <>
            <line x1={xAt(hp.i)} y1={PAD.t} x2={xAt(hp.i)} y2={PAD.t + PLOT_H} stroke="#f4f5f7" strokeWidth="1" opacity={0.3} />
            {SERIES.filter((s) => visible.has(s.key)).map((s) => {
              const v = hp[s.key];
              if (v === null || v === undefined) return null;
              return <circle key={s.key} cx={xAt(hp.i)} cy={yAt(v)} r="3.5" fill={s.color} />;
            })}
          </>
        )}
      </svg>

      <div className="mt-2 min-h-[22px] text-[12px]">
        {hp ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex flex-col leading-tight">
              <span className="font-semibold">
                {matchLabel(hp)}
                {hp.playoff && (
                  <span className="ml-1 rounded bg-gold/15 px-1 text-gold">playoff</span>
                )}
              </span>
              {hp.noShow && (
                <span className="text-[10px] font-normal text-[#6b6f78]">no show</span>
              )}
            </span>
            <span className="text-[#6b6f78]">
              {hp.eventCode} · {fmtDate(hp.time)}
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
          <span className="text-[#6b6f78]">
            Hover the chart for per-match values. Grey bands group events; gold = playoffs.
          </span>
        )}
      </div>
    </div>
  );
}
