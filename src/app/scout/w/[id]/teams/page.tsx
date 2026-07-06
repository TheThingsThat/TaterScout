"use client";

import { use, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const TIER_LABEL: Record<string, string> = {
  t1: "Tier 1",
  t2: "Tier 2",
  t3: "Tier 3",
  dnp: "Do Not Pick",
  uncat: "—",
};
const TIER_CLASS: Record<string, string> = {
  t1: "bg-teal/15 text-teal",
  t2: "bg-[#2f8bff]/15 text-[#4d8dff]",
  t3: "bg-gold/15 text-gold",
  dnp: "bg-accent/15 text-accent",
  uncat: "bg-[#161616] text-[#6b6f78]",
};
const fmt = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(1));
const PIT_CLASS: Record<string, string> = { full: "text-teal", minor: "text-gold", major: "text-accent" };
const PIT_LABEL: Record<string, string> = { full: "OK", minor: "minor", major: "major" };

function DetailModal({
  workspaceId,
  teamNumber,
  onClose,
}: {
  workspaceId: Id<"workspaces">;
  teamNumber: number;
  onClose: () => void;
}) {
  const detail = useQuery(api.teams.detail, { workspaceId, teamNumber });
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl border border-[#232323] bg-[#0c0c0c] p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {detail === undefined || detail.team == null ? (
          <div className="py-8 text-center text-sm text-muted">Loading…</div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[18px] font-bold text-accent">{detail.team.teamNumber}</span>
                  <span className="text-[18px] font-semibold">{detail.team.name}</span>
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {detail.team.region ?? "—"}
                  {detail.team.rank != null ? ` · rank ${detail.team.rank}` : ""}
                </div>
              </div>
              <button onClick={onClose} className="text-[22px] leading-none text-muted hover:text-foreground">
                ×
              </button>
            </div>

            {/* Stats */}
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-[#1a1a1a] bg-surface p-2.5">
                <div className="text-[18px] font-bold tabular-nums" style={{ color: "var(--epa)" }}>
                  {fmt(detail.team.epa)}
                </div>
                <div className="text-[10px] text-muted">EPA</div>
              </div>
              <div className="rounded-xl border border-[#1a1a1a] bg-surface p-2.5">
                <div className="text-[18px] font-bold tabular-nums" style={{ color: "var(--opr)" }}>
                  {fmt(detail.team.oprNp)}
                </div>
                <div className="text-[10px] text-muted">OPR</div>
              </div>
              <div className="rounded-xl border border-[#1a1a1a] bg-surface p-2.5">
                <div className="text-[18px] font-bold tabular-nums">{detail.reports.length}</div>
                <div className="text-[10px] text-muted">reports</div>
              </div>
            </div>

            {/* Pit */}
            {detail.pit && (
              <div className="mt-4">
                <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Pit scouting</div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {detail.pit.nearAuto && <span className="rounded bg-surface px-2 py-1 text-foreground">near auto</span>}
                  {detail.pit.nearTele && <span className="rounded bg-surface px-2 py-1 text-foreground">near teleop</span>}
                  {detail.pit.farAuto && <span className="rounded bg-surface px-2 py-1 text-foreground">far auto</span>}
                  {detail.pit.farTele && <span className="rounded bg-surface px-2 py-1 text-foreground">far teleop</span>}
                  {detail.pit.canFullPark && <span className="rounded bg-surface px-2 py-1 text-foreground">full park</span>}
                  {detail.pit.canTiltPark && <span className="rounded bg-surface px-2 py-1 text-foreground">tilt park</span>}
                </div>
                <div className={`mt-1.5 text-[12px] ${PIT_CLASS[detail.pit.robotStatus]}`}>
                  Robot: {PIT_LABEL[detail.pit.robotStatus]}
                </div>
                {detail.pit.notes && <div className="mt-1 text-[12px] text-muted">{detail.pit.notes}</div>}
              </div>
            )}

            {/* Averages */}
            {detail.averages ? (
              <div className="mt-4">
                <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                  Scouting averages ({detail.averages.count})
                </div>
                <div className="grid grid-cols-2 gap-2 text-[13px]">
                  <div className="rounded-lg bg-surface p-2.5">
                    Auto artifacts <span className="float-right font-semibold">{detail.averages.autoArtifacts.toFixed(1)}</span>
                  </div>
                  <div className="rounded-lg bg-surface p-2.5">
                    TeleOp artifacts <span className="float-right font-semibold">{detail.averages.teleopArtifacts.toFixed(1)}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {(["none", "simple", "tilt", "climb"] as const).map((p) => (
                    <span key={p} className="rounded bg-surface px-2 py-1 text-muted">
                      {p}: <span className="text-foreground">{detail.averages!.parkDist[p] ?? 0}</span>
                    </span>
                  ))}
                </div>
                {Object.keys(detail.averages.tagFreq).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(detail.averages.tagFreq).map(([tag, n]) => (
                      <span key={tag} className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] text-accent">
                        {tag} ×{n}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-[#1a1a1a] bg-surface p-4 text-center text-[13px] text-muted">
                No match reports yet.
              </div>
            )}

            {/* Reports */}
            {detail.reports.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Reports</div>
                <div className="space-y-1.5">
                  {detail.reports.map((r) => (
                    <div key={r._id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-[13px]">
                      <span className="font-mono text-muted">Q{r.matchNumber}</span>
                      <span className="text-[12px] text-muted">
                        auto {r.autoArtifacts} · tele {r.teleopArtifacts} · {r.park}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Teams({ id }: { id: Id<"workspaces"> }) {
  const teams = useQuery(api.teams.list, { workspaceId: id });
  const [selected, setSelected] = useState<number | null>(null);

  if (teams === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (teams.length === 0)
    return (
      <div className="rounded-2xl border border-[#1a1a1a] bg-surface p-6 text-center text-sm text-muted">
        No teams yet — an admin needs to import the event (Setup).
      </div>
    );

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold">Teams ({teams.length})</h2>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
        {teams.map((t) => (
          <button
            key={t._id}
            onClick={() => setSelected(t.teamNumber)}
            className="flex w-full items-center gap-3 border-t border-[#141414] px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-[#101010]"
          >
            <span className="w-14 shrink-0 font-mono text-[13px] text-muted">{t.teamNumber}</span>
            <span className="min-w-0 flex-1 truncate font-medium text-[#e7eaf0]">{t.name}</span>
            <span className="hidden shrink-0 text-[12px] text-muted sm:inline">
              EPA {fmt(t.epa)} · OPR {fmt(t.oprNp)}
            </span>
            <span
              className={`hidden w-10 shrink-0 text-[10px] sm:inline ${
                t.pitScouted ? PIT_CLASS[t.robotStatus ?? "full"] : "text-[#3a3f48]"
              }`}
              title="Pit scouting"
            >
              {t.pitScouted ? `pit ${PIT_LABEL[t.robotStatus ?? "full"]}` : "no pit"}
            </span>
            <span className="shrink-0 text-[12px] text-muted">{t.reportCount} rpt</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${TIER_CLASS[t.tier]}`}>
              {TIER_LABEL[t.tier]}
            </span>
          </button>
        ))}
      </div>

      {selected != null && (
        <DetailModal workspaceId={id} teamNumber={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

export default function TeamsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Teams id={id as Id<"workspaces">} />;
}
