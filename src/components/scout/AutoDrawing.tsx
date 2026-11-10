"use client";

import { useRef, useState } from "react";
import { FIELD_IMAGE, GRID, STROKE_WIDTH, hitStroke, simplify, strokePath, type Stroke } from "@/lib/autoDraw";

/** The field with a drawing on top. Square; fills its container's width. */
function Field({ strokes, live, children }: { strokes: Stroke[]; live?: Stroke | null; children?: React.ReactNode }) {
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border-strong bg-[#2b2b2b]">
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 20 KB asset; next/image adds nothing here */}
      <img src={FIELD_IMAGE} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" />
      <svg viewBox={`0 0 ${GRID} ${GRID}`} className="absolute inset-0 h-full w-full">
        {[...strokes, ...(live ? [live] : [])].map((s, i) => (
          <path
            key={i}
            d={strokePath(s)}
            fill="none"
            stroke="#fff"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      {children}
    </div>
  );
}

/** Read-only drawing (team detail, thumbnails). */
export function AutoView({ strokes }: { strokes: Stroke[] }) {
  return <Field strokes={strokes} />;
}

function PenIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

/**
 * Draw an auto path: a white pen, a whole-line eraser (swipe across a line to
 * remove it) and Clear. Lines are simplified as they're finished, so a drawing
 * stays a few KB.
 */
export function AutoEditor({ value, onChange }: { value: Stroke[]; onChange: (s: Stroke[]) => void }) {
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [live, setLive] = useState<Stroke | null>(null);
  const raw = useRef<[number, number][]>([]);
  // Only the first finger draws; a palm or the thumb holding the phone is ignored.
  const active = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * GRID, ((e.clientY - r.top) / r.height) * GRID];
  };

  const erase = (x: number, y: number) => {
    const k = hitStroke(value, x, y, 28);
    if (k >= 0) onChange(value.filter((_, i) => i !== k));
  };

  function down(e: React.PointerEvent) {
    if (active.current !== null) return;
    active.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    if (tool === "eraser") return erase(...p);
    raw.current = [p];
    setLive([Math.round(p[0]), Math.round(p[1])]);
  }

  function move(e: React.PointerEvent) {
    if (e.pointerId !== active.current) return;
    const p = at(e);
    if (tool === "eraser") return erase(...p);
    raw.current.push(p);
    setLive(raw.current.flatMap(([x, y]) => [Math.round(x), Math.round(y)]));
  }

  function up(e: React.PointerEvent) {
    if (e.pointerId !== active.current) return;
    active.current = null;
    if (tool === "pen" && raw.current.length) onChange([...value, simplify(raw.current)]);
    raw.current = [];
    setLive(null);
  }

  const toolBtn = (t: "pen" | "eraser", label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setTool(t)}
      aria-pressed={tool === t}
      className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-xl border text-[15px] font-semibold transition-colors ${
        tool === t ? "border-heading bg-heading text-background" : "border-border-strong text-muted hover:border-border-hover"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2.5">
        {toolBtn("pen", "Draw", <PenIcon />)}
        {toolBtn("eraser", "Erase", <EraserIcon />)}
      </div>
      <div
        ref={box}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        // No scrolling or zooming while a finger is on the field.
        style={{ touchAction: "none", cursor: tool === "pen" ? "crosshair" : "cell" }}
      >
        <Field strokes={value} live={live} />
      </div>
      <div className="flex items-center justify-between text-[12px] text-dim">
        <span>{tool === "pen" ? "Draw the path with your finger." : "Swipe across a line to erase it."}</span>
        <button
          type="button"
          disabled={value.length === 0}
          onClick={() => confirm("Clear this whole drawing?") && onChange([])}
          className="rounded-lg px-2 py-1 text-muted hover:text-foreground disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
