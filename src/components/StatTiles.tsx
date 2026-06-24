import type { QuickStats, QuickStat } from "@/lib/ftc/types";
import { fmt, ordinal, rankPercentile } from "@/lib/format";

const TILES: {
  key: keyof Pick<QuickStats, "tot" | "auto" | "dc" | "eg">;
  label: string;
  hint: string;
  accent: string;
}[] = [
  { key: "tot", label: "Total OPR", hint: "Overall scoring power", accent: "var(--accent)" },
  { key: "auto", label: "Auto", hint: "Autonomous period", accent: "var(--accent-2)" },
  { key: "dc", label: "TeleOp", hint: "Driver-controlled", accent: "var(--blue)" },
  { key: "eg", label: "Endgame", hint: "End of match", accent: "var(--gold)" },
];

function Tile({
  label,
  hint,
  stat,
  count,
  accent,
}: {
  label: string;
  hint: string;
  stat: QuickStat;
  count: number;
  accent: string;
}) {
  const pct = rankPercentile(stat.rank, count);
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          {label}
        </span>
        <span className="text-[11px] text-muted">{hint}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums" style={{ color: accent }}>
          {fmt(stat.value)}
        </span>
        <span className="text-xs text-muted">
          {ordinal(stat.rank)}
          {count ? ` / ${count.toLocaleString()}` : ""}
        </span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: accent }}
        />
      </div>
      <div className="mt-1 text-[11px] text-muted">
        Top {Math.max(0.1, 100 - pct).toFixed(pct > 99 ? 1 : 0)}%
      </div>
    </div>
  );
}

export default function StatTiles({ stats }: { stats: QuickStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((t) => (
        <Tile
          key={t.key}
          label={t.label}
          hint={t.hint}
          stat={stats[t.key]}
          count={stats.count}
          accent={t.accent}
        />
      ))}
    </div>
  );
}
