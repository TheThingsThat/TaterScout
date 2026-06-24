import Link from "next/link";
import type { SimResult } from "@/lib/predict/simulate";

const TH = "px-2.5 py-3 text-right font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]";

function pct(x: number): string {
  if (x >= 99.95) return ">99%";
  if (x > 0 && x < 0.1) return "<0.1%";
  return `${x.toFixed(x < 10 ? 1 : 0)}%`;
}

export default function EventPredictions({
  result,
  season,
  limit = 24,
}: {
  result: SimResult;
  season: number;
  limit?: number;
}) {
  const champs = result.divisionCount != null;
  const rows = result.teams.slice(0, limit);
  return (
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      <div className="ts-scroll overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#1f1f1f]">
              <th className="px-3.5 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">#</th>
              <th className="px-3.5 py-3 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b6f78]">Team</th>
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
                className="border-b border-[#141414] transition-colors last:border-0 hover:bg-[#101010]"
              >
                <td className="px-3.5 py-2.5 font-mono text-[#6b6f78]">{i + 1}</td>
                <td className="px-3.5 py-2.5">
                  <Link href={`/teams/${t.number}?season=${season}`} className="no-underline hover:text-accent">
                    <span className="font-mono text-[#6b6f78]">{t.number}</span>
                  </Link>
                </td>
                <td className="px-2.5 py-2.5 text-right font-semibold tabular-nums text-accent">
                  {pct(t.winPct)}
                </td>
                {champs && (
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-[#9aa0aa]">
                    {pct(t.divWinPct ?? 0)}
                  </td>
                )}
                <td className="px-2.5 py-2.5 text-right tabular-nums text-[#9aa0aa]">{pct(t.playoffPct)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums text-[#6b6f78]">{pct(t.captainPct)}</td>
                <td className="px-2.5 py-2.5 text-right font-mono tabular-nums text-[#6b6f78]">
                  {t.meanSeed.toFixed(1)}
                  <span className="text-[#3a3f48]"> ({t.bestSeed}–{t.worstSeed})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3.5 py-[11px] text-[11px] text-[#6b6f78]">
        {result.iters.toLocaleString()} Monte-Carlo simulations · {result.allianceCount}×
        {result.allianceSize} alliances. EPA-driven; quals → alliance selection →
        double-elim.
      </p>
    </div>
  );
}
