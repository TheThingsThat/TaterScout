import Link from "next/link";
import type { SimResult } from "@/lib/predict/simulate";

const TH = "px-2.5 py-3 text-right font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim";

function pct(x: number): string {
  if (x >= 99.95) return ">99%";
  if (x > 0 && x < 0.1) return "<0.1%";
  return `${x.toFixed(x < 10 ? 1 : 0)}%`;
}

export default function EventPredictions({
  result,
  season,
}: {
  result: SimResult;
  season: number;
}) {
  const champs = result.divisionCount != null;
  const rows = result.teams;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="ts-scroll overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3.5 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim">#</th>
              <th className="px-3.5 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim">Team</th>
              <th className={TH} style={{ color: "var(--accent)" }}>
                {champs ? "Win Worlds" : "Win"}
              </th>
              {champs && <th className={TH}>Win Div</th>}
              <th className={TH}>Playoffs</th>
              <th className={TH}>Captain</th>
              <th className={TH}>Avg seed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr
                key={t.number}
                className="border-b border-line transition-colors last:border-0 hover:bg-hover"
              >
                <td className="px-3.5 py-2.5 font-mono text-dim">{i + 1}</td>
                <td className="px-3.5 py-2.5">
                  <Link prefetch={false} href={`/teams/${t.number}?season=${season}`} className="no-underline hover:text-accent">
                    <span className="font-mono text-dim">{t.number}</span>
                  </Link>
                </td>
                <td className="px-2.5 py-2.5 text-right font-semibold tabular-nums text-accent">
                  {pct(t.winPct)}
                </td>
                {champs && (
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-muted">
                    {pct(t.divWinPct ?? 0)}
                  </td>
                )}
                <td className="px-2.5 py-2.5 text-right tabular-nums text-muted">{pct(t.playoffPct)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums text-dim">{pct(t.captainPct)}</td>
                <td className="px-2.5 py-2.5 text-right font-mono tabular-nums text-dim">
                  {t.meanSeed.toFixed(1)}
                  <span className="text-faint"> ({t.bestSeed}–{t.worstSeed})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3.5 py-[11px] text-[11px] text-dim">
        {result.iters.toLocaleString()} Monte-Carlo simulations · {result.allianceCount}×
        {result.allianceSize} alliances. EPA-driven; quals → alliance selection →
        double-elim.
      </p>
    </div>
  );
}
