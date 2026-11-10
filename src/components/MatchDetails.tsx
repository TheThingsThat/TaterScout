"use client";

import { useState } from "react";
import type { BreakdownLine, MatchBreakdown } from "@/lib/ftc/types";

function Row({
  label,
  red,
  blue,
  redNote,
  blueNote,
  strong,
}: {
  label: string;
  red: string | number;
  blue: string | number;
  redNote?: string | null;
  blueNote?: string | null;
  strong?: boolean;
}) {
  const note = (text?: string | null) =>
    text ? <span className="mr-1.5 text-[10px] text-dim">{text}</span> : null;
  const value = `py-[3px] text-right tabular-nums ${strong ? "font-semibold" : ""}`;
  return (
    <tr className={strong ? "text-body" : "text-muted"}>
      <th scope="row" className={`py-[3px] text-left ${strong ? "font-semibold" : "pl-3 font-normal"}`}>
        {label}
      </th>
      <td className={value}>
        {note(redNote)}
        {red}
      </td>
      <td className={value}>
        {note(blueNote)}
        {blue}
      </td>
    </tr>
  );
}

function BreakdownTable({
  b,
  totalRed,
  totalBlue,
}: {
  b: MatchBreakdown;
  totalRed: number | null;
  totalBlue: number | null;
}) {
  const lines = (ls: BreakdownLine[]) =>
    ls.map((l) => (
      <Row key={l.label} label={l.label} red={l.red} blue={l.blue} redNote={l.redNote} blueNote={l.blueNote} />
    ));
  const yes = (earned: boolean) => (earned ? "✓" : "–");
  return (
    <div className="border-t border-line bg-surface px-4 py-3">
      <table className="mx-auto w-full max-w-[420px] border-collapse text-[12px]">
        <thead>
          <tr className="font-mono text-[10px] uppercase tracking-[0.08em]">
            <th className="w-[46%]" />
            <th className="pb-1 text-right font-bold text-red">Red</th>
            <th className="pb-1 text-right font-bold text-blue">Blue</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Auto" red={b.autoRed} blue={b.autoBlue} strong />
          {lines(b.auto)}
          <Row label="TeleOp" red={b.teleopRed} blue={b.teleopBlue} strong />
          {lines(b.teleop)}
          <Row label="Penalty points" red={b.foulPointsRed} blue={b.foulPointsBlue} strong />
          <Row label="Fouls (major / minor)" red={b.foulsRed} blue={b.foulsBlue} />
          <Row label="Total" red={totalRed ?? "—"} blue={totalBlue ?? "—"} strong />
          {b.rp.length > 0 && (
            <>
              <Row label="Ranking points" red={b.rpTotalRed} blue={b.rpTotalBlue} strong />
              {b.rp.map((c) => (
                <Row key={c.label} label={c.label} red={yes(c.red)} blue={yes(c.blue)} />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A match row that opens onto its score breakdown. The table only renders once
 *  opened, so a 150-match event doesn't carry thousands of hidden table cells. */
export default function MatchDetails({
  breakdown,
  totalRed,
  totalBlue,
  className,
  children,
}: {
  breakdown: MatchBreakdown;
  totalRed: number | null;
  totalBlue: number | null;
  className: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={`group ${className}`}
      // A tap on a slow connection can open the row before this code has loaded.
      ref={(el) => {
        if (el?.open) setOpen(true);
      }}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{children}</summary>
      {open && <BreakdownTable b={breakdown} totalRed={totalRed} totalBlue={totalBlue} />}
    </details>
  );
}
