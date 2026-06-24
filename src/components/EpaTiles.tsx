import type { TeamRanking } from "@/lib/rankings";
import { fmt, ordinal, rankPercentile } from "@/lib/format";

const EPA = "var(--epa)";

function Bar({ pct }: { pct: number }) {
  return (
    <>
      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-[#161616]">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: EPA }}
        />
      </div>
      <div className="mt-1.5 text-[11px] text-[#6b6f78]">
        Top {Math.max(0.1, 100 - pct).toFixed(pct > 99 ? 1 : 0)}%
      </div>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
      {children}
    </span>
  );
}

function Component({
  label,
  value,
  rank,
  teamCount,
}: {
  label: string;
  value: number | null;
  rank: number | null;
  teamCount: number;
}) {
  const pct = rank !== null ? rankPercentile(rank, teamCount) : 0;
  return (
    <div className="rounded-2xl border border-[#1a1a1a] bg-surface p-[18px]">
      <Label>{label}</Label>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="text-[26px] font-bold tabular-nums" style={{ color: EPA }}>
          {fmt(value)}
        </span>
        <span className="text-[12px] text-[#6b6f78]">
          {rank !== null ? ordinal(rank) : "—"}
        </span>
      </div>
      <Bar pct={pct} />
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
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
      <div className="col-span-2 rounded-2xl border border-[#1a1a1a] bg-surface p-[18px]">
        <div className="flex items-baseline justify-between">
          <Label>Total EPA</Label>
          <span className="text-[11px] text-[#6b6f78]">{team.n} matches</span>
        </div>
        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="text-[34px] font-bold tabular-nums" style={{ color: EPA }}>
            {fmt(team.epa)}
          </span>
          <span className="text-[12px] text-[#6b6f78]">
            {team.rkEpa !== null ? ordinal(team.rkEpa) : "—"}
            {teamCount ? ` / ${teamCount.toLocaleString()}` : ""}
          </span>
        </div>
        <Bar pct={pct} />
      </div>
      <Component label="Auto EPA" value={team.epaAuto} rank={team.rkEpaAuto} teamCount={teamCount} />
      <Component label="TeleOp EPA" value={team.epaTele} rank={team.rkEpaTele} teamCount={teamCount} />
    </div>
  );
}
