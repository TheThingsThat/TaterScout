import type { QuickStats, QuickStat } from "@/lib/ftc/types";
import { fmt, ordinal, rankPercentile } from "@/lib/format";

const OPR = "var(--opr)";

const TILES: {
  key: keyof Pick<QuickStats, "tot" | "auto" | "dc" | "eg">;
  label: string;
  hint: string;
}[] = [
  { key: "tot", label: "Total OPR", hint: "Overall" },
  { key: "auto", label: "Auto", hint: "Autonomous" },
  { key: "dc", label: "TeleOp", hint: "Driver" },
  { key: "eg", label: "Endgame", hint: "End of match" },
];

function Tile({
  label,
  hint,
  stat,
  count,
}: {
  label: string;
  hint: string;
  stat: QuickStat;
  count: number;
}) {
  const pct = rankPercentile(stat.rank, count);
  return (
    <div className="rounded-2xl border border-[#1a1a1a] bg-surface p-[18px]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
        <span className="text-[10px] text-[#6b6f78]">{hint}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="text-[26px] font-bold tabular-nums" style={{ color: OPR }}>
          {fmt(stat.value)}
        </span>
        <span className="text-[12px] text-[#6b6f78]">
          {ordinal(stat.rank)}
          {count ? ` / ${count.toLocaleString()}` : ""}
        </span>
      </div>
      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-[#161616]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: OPR }} />
      </div>
    </div>
  );
}

export default function StatTiles({ stats }: { stats: QuickStats }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
      {TILES.map((t) => (
        <Tile key={t.key} label={t.label} hint={t.hint} stat={stats[t.key]} count={stats.count} />
      ))}
    </div>
  );
}
