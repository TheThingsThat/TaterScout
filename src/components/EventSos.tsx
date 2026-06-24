"use client";

import { useState } from "react";
import Link from "next/link";
import type { SosResult } from "@/lib/predict/sos";

const TH = "px-2.5 py-3 text-right font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]";

const pct = (x: number) => `${Math.round(x * 100)}%`;

// Green (easy) → red (hard) on the 0..1 difficulty scale.
function diffColor(c: number): { bg: string; fg: string } {
  const hue = 140 * (1 - Math.max(0, Math.min(1, c)));
  return { bg: `hsl(${hue} 60% 48% / 0.16)`, fg: `hsl(${hue} 72% 64%)` };
}

export default function EventSos({
  pre,
  post,
  season,
}: {
  pre: SosResult;
  post: SosResult;
  season: number;
}) {
  const [mode, setMode] = useState<"pre" | "post">("pre");
  const result = mode === "pre" ? pre : post;

  const tabs: { v: "pre" | "post"; label: string }[] = [
    { v: "pre", label: "Pre-event" },
    { v: "post", label: "Post-event" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f1f1f] px-3.5 py-2.5">
        <span className="text-[11px] text-[#6b6f78]">Higher = harder schedule draw</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-[#232323]">
          {tabs.map((t) => (
            <button
              key={t.v}
              onClick={() => setMode(t.v)}
              className="px-3 py-1.5 text-[12px] transition-colors"
              style={
                mode === t.v
                  ? { background: "var(--accent)", color: "#fff" }
                  : { background: "transparent", color: "#9aa0aa" }
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ts-scroll overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#1f1f1f]">
              <th className="px-3.5 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">#</th>
              <th className="px-3.5 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">Team</th>
              <th className={TH} style={{ color: "#c9cdd4" }}>Composite</th>
              <th className={TH}>Δ RP</th>
              <th className={TH}>Δ Rank</th>
              <th className={TH}>Δ EPA</th>
            </tr>
          </thead>
          <tbody>
            {result.teams.map((t, i) => {
              const col = diffColor(t.composite);
              return (
                <tr
                  key={t.number}
                  className="border-b border-[#141414] transition-colors last:border-0 hover:bg-[#101010]"
                >
                  <td className="px-3.5 py-2.5 font-mono text-[#6b6f78]">{i + 1}</td>
                  <td className="px-3.5 py-2.5">
                    <Link href={`/teams/${t.number}?season=${season}`} className="no-underline hover:text-accent">
                      <span className="font-mono text-[#6b6f78]">{t.number}</span>
                    </Link>
                  </td>
                  <td className="px-2.5 py-2 text-right">
                    <span
                      className="inline-block rounded-md px-2 py-0.5 font-semibold tabular-nums"
                      style={{ background: col.bg, color: col.fg }}
                    >
                      {pct(t.composite)}
                    </span>
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-[#9aa0aa]">{pct(t.rpPctile)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-[#9aa0aa]">{pct(t.rankPctile)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-[#9aa0aa]">
                    {pct(t.epaPctile)}
                    <span className="ml-1 text-[11px] text-[#52565e]">
                      ({t.deltaEpa >= 0 ? "+" : ""}
                      {t.deltaEpa.toFixed(0)})
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3.5 py-[11px] text-[11px] text-[#6b6f78]">
        Percentile of {result.iters.toLocaleString()} random balanced schedules easier than the actual draw.
        Δ EPA = points of head/tail-wind from partner vs opponent strength. Diagnostic only — not part of EPA or predictions.
      </p>
    </div>
  );
}
