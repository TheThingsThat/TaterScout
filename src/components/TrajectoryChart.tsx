"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatDate } from "@/lib/format";
import type { TrajPoint, EventSegment } from "@/lib/trajectory";

type Key = "epa" | "epaAuto" | "epaTele" | "opr" | "oprAuto" | "oprTele";

const EPA = "var(--epa)";
const OPR = "var(--opr)";

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

// Drawn in CSS pixels at the chart's real width (measured below), so labels stay
// readable on a phone instead of shrinking with a scaled-down fixed canvas.
const SSR_W = 1000; // until measured: the desktop layout, as before
const MONO = "var(--font-spacemono), monospace";
const CHAR_W = 6.6; // Space Mono advance at 11px, for fitting labels

const subscribe = () => () => {};

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
  const [W, setW] = useState(SSR_W);
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 640;
  const H = narrow ? 240 : Math.round(W * 0.42);
  const PAD = narrow ? { l: 34, r: 8, t: 10, b: 44 } : { l: 40, r: 14, t: 14, b: 64 };
  const PLOT_W = W - PAD.l - PAD.r;
  const PLOT_H = H - PAD.t - PAD.b;
  // Match dates in the viewer's zone (a US evening match is already the next day
  // in UTC); SSR and hydration use UTC so they match, then the client swaps.
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  const fmtDate = (ms: number) => formatDate(ms, { year: false, local: isClient });

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
  // Whole numbers unless the range is small: keeps labels short enough for the axis gutter.
  const tickScale = hi - lo > 10 ? 1 : 10;
  for (let k = 0; k <= 3; k++) {
    ticks.push(Math.round((lo + ((hi - lo) * k) / 3) * tickScale) / tickScale);
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

  function onMove(e: React.PointerEvent) {
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
    <div className="rounded-2xl border border-border bg-surface p-[18px]">
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
                  ? { background: "var(--surface-2)", border: "1px solid var(--border-strong)", color: "var(--foreground)" }
                  : { background: "transparent", border: "1px solid transparent", color: "var(--dim)" }
              }
            >
              <svg width="16" height="6">
                <line
                  x1="0"
                  y1="3"
                  x2="16"
                  y2="3"
                  style={{ stroke: s.color }}
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
        // pan-y: vertical swipes still scroll the page, horizontal drags scrub.
        // A touch keeps its last readout after the finger lifts.
        style={{ touchAction: "pan-y" }}
        onPointerDown={onMove}
        onPointerMove={onMove}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHover(null);
        }}
      >
        {segments.map((seg, idx) => {
          const left = Math.max(PAD.l, xAt(seg.start) - halfStep);
          const right = Math.min(W - PAD.r, xAt(seg.end) + halfStep);
          const mid = (left + right) / 2;
          const room = right - left;
          const date = fmtDate(points[seg.start].time);
          // Only label an event whose band fits the text; the hover readout names it anyway.
          const showCode = room >= seg.code.length * CHAR_W + 6;
          const showDate = room >= date.length * CHAR_W * 0.9 + 6;
          return (
            <g key={`${seg.code}-${idx}`}>
              <rect
                x={left}
                y={PAD.t}
                width={Math.max(0, room)}
                height={PLOT_H}
                style={{ fill: idx % 2 ? "color-mix(in srgb, var(--foreground) 3%, transparent)" : "transparent" }}
              />
              {showCode && (
                <text x={mid} y={H - PAD.b + 18} textAnchor="middle" className="fill-dim" fontSize="11" fontFamily={MONO}>
                  {seg.code}
                </text>
              )}
              {showDate && (
                <text x={mid} y={H - PAD.b + 32} textAnchor="middle" className="fill-dim" fontSize="10" fontFamily={MONO}>
                  {date}
                </text>
              )}
            </g>
          );
        })}

        {/* Matches the team played that couldn't be rated (an alliance was a
            robot short). The rating line runs flat through these, so mark them
            or they'd read as an ordinary stretch of no improvement. */}
        {points.map((p, i) =>
          p.noShow ? (
            <line
              key={`ns-${i}`}
              x1={xAt(i)}
              y1={PAD.t}
              x2={xAt(i)}
              y2={PAD.t + PLOT_H}
              className="stroke-dim"
              strokeWidth="1.5"
              strokeDasharray="3 3"
              opacity={0.5}
            />
          ) : null,
        )}

        {points.map((p, i) => {
          if (!p.playoff) return null;
          // Clamp to the plot area so a trailing playoff point doesn't render a
          // sliver past the right edge.
          const left = Math.max(PAD.l, xAt(i) - halfStep);
          const right = Math.min(W - PAD.r, xAt(i) + halfStep);
          return (
            <rect
              key={`po-${i}`}
              x={left}
              y={PAD.t}
              width={Math.max(1, right - left)}
              height={PLOT_H}
              style={{ fill: "var(--gold)" }}
              opacity={0.08}
            />
          );
        })}

        {ticks.map((t) => (
          <g key={`t-${t}`}>
            <line x1={PAD.l} y1={yAt(t)} x2={W - PAD.r} y2={yAt(t)} className="stroke-border" strokeWidth="1" />
            <text x={PAD.l - 6} y={yAt(t) + 3} textAnchor="end" className="fill-dim" fontSize="10" fontFamily={MONO}>
              {t}
            </text>
          </g>
        ))}

        {SERIES.filter((s) => visible.has(s.key)).map((s) => (
          <path
            key={s.key}
            d={pathFor(s.key)}
            fill="none"
            style={{ stroke: s.color }}
            strokeWidth={s.width}
            strokeDasharray={s.dash}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hp && (
          <>
            <line x1={xAt(hp.i)} y1={PAD.t} x2={xAt(hp.i)} y2={PAD.t + PLOT_H} className="stroke-foreground" strokeWidth="1" opacity={0.3} />
            {SERIES.filter((s) => visible.has(s.key)).map((s) => {
              const v = hp[s.key];
              if (v === null || v === undefined) return null;
              return <circle key={s.key} cx={xAt(hp.i)} cy={yAt(v)} r="3.5" style={{ fill: s.color }} />;
            })}
          </>
        )}
      </svg>

      {/* Tall enough for the no-show subline, so the page below doesn't jump on hover. */}
      <div className="mt-2 min-h-[36px] text-[12px]">
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
                <span className="text-[10px] font-normal text-dim">
                  not rated · alliance a robot short
                </span>
              )}
            </span>
            <span className="text-dim">
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
          <span className="text-dim">
            Hover the chart for per-match values. Grey bands group events; gold = playoffs.
          </span>
        )}
      </div>
    </div>
  );
}
