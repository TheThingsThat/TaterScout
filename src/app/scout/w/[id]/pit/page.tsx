"use client";

import { use, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";

type RobotStatus = "full" | "minor" | "major";

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-[14px] transition-colors ${
        on ? "border-accent bg-accent/15 text-foreground" : "border-[#232323] text-muted hover:border-[#3a3a3a]"
      }`}
    >
      {children}
    </button>
  );
}

function ModalShell({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl border border-[#232323] bg-[#0c0c0c] p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[17px] font-semibold">{title}</h3>
          <button onClick={onClose} className="text-[22px] leading-none text-muted hover:text-foreground">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Inner form initializes its state from the loaded report (no effect needed).
function PitFormInner({
  workspaceId,
  teamNumber,
  initial,
  onClose,
}: {
  workspaceId: Id<"workspaces">;
  teamNumber: number;
  initial: Doc<"pitReports"> | null;
  onClose: () => void;
}) {
  const upsert = useMutation(api.pit.upsert);
  const [farAuto, setFarAuto] = useState(initial?.farAuto ?? false);
  const [farTele, setFarTele] = useState(initial?.farTele ?? false);
  const [nearAuto, setNearAuto] = useState(initial?.nearAuto ?? false);
  const [nearTele, setNearTele] = useState(initial?.nearTele ?? false);
  const [canFullPark, setCanFullPark] = useState(initial?.canFullPark ?? false);
  const [canTiltPark, setCanTiltPark] = useState(initial?.canTiltPark ?? false);
  const [robotStatus, setRobotStatus] = useState<RobotStatus>(initial?.robotStatus ?? "full");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await upsert({
        workspaceId, teamNumber,
        farAuto, farTele, nearAuto, nearTele, canFullPark, canTiltPark, robotStatus,
        notes: notes || undefined,
      });
      toast.success(`Saved pit scout · ${teamNumber}`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <section>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Scoring capability</div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle on={nearAuto} onClick={() => setNearAuto(!nearAuto)}>Near auto</Toggle>
          <Toggle on={nearTele} onClick={() => setNearTele(!nearTele)}>Near teleop</Toggle>
          <Toggle on={farAuto} onClick={() => setFarAuto(!farAuto)}>Far auto</Toggle>
          <Toggle on={farTele} onClick={() => setFarTele(!farTele)}>Far teleop</Toggle>
        </div>
      </section>

      <section>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Park capability</div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle on={canFullPark} onClick={() => setCanFullPark(!canFullPark)}>Can full park</Toggle>
          <Toggle on={canTiltPark} onClick={() => setCanTiltPark(!canTiltPark)}>Can tilt park</Toggle>
        </div>
      </section>

      <section>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Robot status</div>
        <div className="grid grid-cols-3 gap-2">
          {([["full", "Fully functioning"], ["minor", "Minor issues"], ["major", "Major issues"]] as const).map(
            ([val, label]) => (
              <Toggle key={val} on={robotStatus === val} onClick={() => setRobotStatus(val)}>{label}</Toggle>
            ),
          )}
        </div>
      </section>

      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full rounded-xl border border-[#232323] bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3a3a3a]"
      />

      <button
        onClick={save}
        disabled={busy}
        className="w-full rounded-xl bg-accent px-4 py-3 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function PitForm({ workspaceId, teamNumber, onClose }: { workspaceId: Id<"workspaces">; teamNumber: number; onClose: () => void }) {
  const existing = useQuery(api.pit.get, { workspaceId, teamNumber });
  return (
    <ModalShell title={<>Pit scout · <span className="font-mono">{teamNumber}</span></>} onClose={onClose}>
      {existing === undefined ? (
        <div className="py-8 text-center text-sm text-muted">Loading…</div>
      ) : (
        <PitFormInner workspaceId={workspaceId} teamNumber={teamNumber} initial={existing} onClose={onClose} />
      )}
    </ModalShell>
  );
}

const STATUS_LABEL: Record<string, string> = { full: "OK", minor: "Minor", major: "Major" };
const STATUS_CLASS: Record<string, string> = { full: "text-teal", minor: "text-gold", major: "text-accent" };

function Pit({ id }: { id: Id<"workspaces"> }) {
  const teams = useQuery(api.teams.list, { workspaceId: id });
  const [selected, setSelected] = useState<number | null>(null);

  if (teams === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (teams.length === 0)
    return (
      <div className="rounded-2xl border border-[#1a1a1a] bg-surface p-6 text-center text-sm text-muted">
        No teams yet — import the event first (Setup).
      </div>
    );

  const scouted = teams.filter((t) => t.pitScouted).length;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold">Pit scouting</h2>
        <span className="text-[13px] text-muted">{scouted}/{teams.length} scouted</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {teams.map((t) => (
          <button
            key={t._id}
            onClick={() => setSelected(t.teamNumber)}
            className={`rounded-xl border p-3 text-left transition-colors hover:bg-[#101010] ${
              t.pitScouted ? "border-[#233] bg-teal/[0.04]" : "border-[#232323]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[14px] font-bold">{t.teamNumber}</span>
              {t.pitScouted ? (
                <span className={`text-[10px] ${STATUS_CLASS[t.robotStatus ?? "full"]}`}>
                  ✓ {STATUS_LABEL[t.robotStatus ?? "full"]}
                </span>
              ) : (
                <span className="text-[10px] text-[#4a4f57]">not scouted</span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-muted">{t.name}</div>
          </button>
        ))}
      </div>

      {selected != null && <PitForm workspaceId={id} teamNumber={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

export default function PitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Pit id={id as Id<"workspaces">} />;
}
