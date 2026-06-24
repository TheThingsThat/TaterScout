import type { TeamRanking } from "@/lib/rankings";
import { fmt, ordinal, rankPercentile } from "@/lib/format";

function PercentBar({ pct, color }: { pct: number; color: string }) {
  return (
    <>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="mt-1 text-[11px] text-muted">
        Top {Math.max(0.1, 100 - pct).toFixed(pct > 99 ? 1 : 0)}%
      </div>
    </>
  );
}

function ComponentTile({
  label,
  value,
  rank,
  teamCount,
  color,
}: {
  label: string;
  value: number | null;
  rank: number | null;
  teamCount: number;
  color: string;
}) {
  const pct = rank !== null ? rankPercentile(rank, teamCount) : 0;
  return (
    <div className="card p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>
          {fmt(value)}
        </span>
        <span className="text-xs text-muted">
          {rank !== null ? ordinal(rank) : "—"}
        </span>
      </div>
      <PercentBar pct={pct} color={color} />
    </div>
  );
}

export default function EpaTiles({
  team,
  teamCount,
}: {
  team: TeamRanking;
  teamCount: number;
}) {
  const pct = team.rkEpa !== null ? rankPercentile(team.rkEpa, teamCount) : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* Total EPA — headline */}
      <div className="card col-span-2 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Total EPA
          </span>
          <span className="text-[11px] text-muted">{team.n} matches</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums text-accent-2">
            {fmt(team.epa)}
          </span>
          <span className="text-xs text-muted">
            {team.rkEpa !== null ? ordinal(team.rkEpa) : "—"}
            {teamCount ? ` / ${teamCount.toLocaleString()}` : ""}
          </span>
        </div>
        <PercentBar pct={pct} color="var(--accent-2)" />
      </div>

      <ComponentTile
        label="Auto EPA"
        value={team.epaAuto}
        rank={team.rkEpaAuto}
        teamCount={teamCount}
        color="var(--accent-2)"
      />
      <ComponentTile
        label="TeleOp EPA"
        value={team.epaTele}
        rank={team.rkEpaTele}
        teamCount={teamCount}
        color="var(--blue)"
      />
    </div>
  );
}
