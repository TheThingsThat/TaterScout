"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import Collapsible from "@/components/Collapsible";
import { formatClock } from "@/lib/format";

const CARD = "rounded-2xl border border-[#1a1a1a] bg-surface p-5";

// ---- Members table ----------------------------------------------------------
function MembersTable({ id }: { id: Id<"workspaces"> }) {
  const members = useQuery(api.members.list, { workspaceId: id });
  const setRole = useMutation(api.members.setRole);
  const remove = useMutation(api.members.remove);

  if (members === undefined) return <div className="text-sm text-muted">Loading…</div>;

  async function act(fn: Promise<unknown>) {
    try {
      await fn;
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
      {members.map((m) => (
        <div key={m._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#141414] px-4 py-3 first:border-t-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-[#e7eaf0]">{m.name}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                  m.role === "admin" ? "bg-accent/15 text-accent" : "bg-[#161616] text-muted"
                }`}
              >
                {m.role}
              </span>
            </div>
            <div className="truncate text-[12px] text-[#6b6f78]">{m.email ?? "—"}</div>
          </div>
          <div className="text-right text-[12px] text-muted">
            <div>{m.matchSubmitted}/{m.matchAssigned} match</div>
            <div>{m.pitSubmitted}/{m.pitAssigned} pit</div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {m.role === "scout" ? (
              <button
                onClick={() => act(setRole({ workspaceId: id, memberId: m._id, role: "admin" }))}
                className="rounded-lg border border-[#232323] px-2.5 py-1 text-[12px] text-muted hover:border-[#3a3a3a] hover:text-foreground"
              >
                Promote
              </button>
            ) : (
              <button
                onClick={() => act(setRole({ workspaceId: id, memberId: m._id, role: "scout" }))}
                className="rounded-lg border border-[#232323] px-2.5 py-1 text-[12px] text-muted hover:border-[#3a3a3a] hover:text-foreground"
              >
                Demote
              </button>
            )}
            <button
              onClick={() => {
                if (confirm(`Remove ${m.name} from this workspace?`)) act(remove({ workspaceId: id, memberId: m._id }));
              }}
              className="rounded-lg border border-[#232323] px-2.5 py-1 text-[12px] text-muted hover:border-accent/50 hover:text-accent"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Delegation panel -------------------------------------------------------
function DelegationPanel({
  id,
  kind,
  teams,
  members,
}: {
  id: Id<"workspaces">;
  kind: "match" | "pit";
  teams: { teamNumber: number; name: string }[];
  members: { _id: Id<"members">; name: string; role: string }[];
}) {
  const assignMatches = useMutation(api.assignments.autoAssignMatches);
  const assignPits = useMutation(api.assignments.autoAssignPits);
  const [pickedTeams, setPickedTeams] = useState<Set<number>>(new Set());
  // Track who's been UNchecked (default = everyone selected). Storing the
  // exclusions means a member joining/leaving mid-setup doesn't wipe the
  // admin's in-progress selection or leave a stale id behind.
  const [excludedScouts, setExcludedScouts] = useState<Set<Id<"members">>>(new Set());
  const pickedScouts = new Set(members.map((m) => m._id).filter((mid) => !excludedScouts.has(mid)));
  const [busy, setBusy] = useState(false);
  const [teamQ, setTeamQ] = useState("");

  const shown = teamQ.trim()
    ? teams.filter((t) => `${t.teamNumber} ${t.name}`.toLowerCase().includes(teamQ.trim().toLowerCase()))
    : teams;

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  }

  async function run() {
    setBusy(true);
    try {
      const args = {
        workspaceId: id,
        teamNumbers: [...pickedTeams],
        memberIds: [...pickedScouts],
      };
      const r = kind === "match" ? await assignMatches(args) : await assignPits(args);
      toast.success(`Assigned ${r.assigned} ${kind === "match" ? "match slots" : "pits"}`);
      setPickedTeams(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={CARD}>
      <h3 className="text-[15px] font-semibold">Auto-assign {kind === "match" ? "matches" : "pits"}</h3>
      <p className="mt-1 text-[13px] text-muted">
        Pick teams and scouts; the system finds the {kind === "match" ? "matches those teams play and" : ""} splits
        them evenly. Re-running replaces existing {kind} assignments for the chosen teams.
      </p>

      {/* Scouts */}
      <div className="mt-3">
        <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Scouts</div>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button
              key={m._id}
              onClick={() => setExcludedScouts(toggle(excludedScouts, m._id))}
              className={`rounded-full border px-2.5 py-1 text-[12px] ${
                pickedScouts.has(m._id) ? "border-accent bg-accent/15 text-accent" : "border-[#232323] text-muted"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {/* Teams */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            Teams ({pickedTeams.size} picked)
          </span>
          <div className="flex gap-2 text-[12px]">
            <button onClick={() => setPickedTeams(new Set(shown.map((t) => t.teamNumber)))} className="text-accent hover:underline">
              select all
            </button>
            <button onClick={() => setPickedTeams(new Set())} className="text-muted hover:text-foreground">
              clear
            </button>
          </div>
        </div>
        <input
          value={teamQ}
          onChange={(e) => setTeamQ(e.target.value)}
          placeholder="Filter teams…"
          className="mb-2 w-full rounded-lg border border-[#232323] bg-surface px-3 py-2 text-[13px] outline-none focus:border-[#3a3a3a]"
        />
        <div className="ts-scroll flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {shown.map((t) => (
            <button
              key={t.teamNumber}
              onClick={() => setPickedTeams(toggle(pickedTeams, t.teamNumber))}
              title={t.name}
              className={`rounded-lg border px-2 py-1 font-mono text-[12px] ${
                pickedTeams.has(t.teamNumber) ? "border-accent bg-accent/15 text-accent" : "border-[#232323] text-muted"
              }`}
            >
              {t.teamNumber}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={run}
        disabled={busy || pickedTeams.size === 0 || pickedScouts.size === 0}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Assigning…" : `Auto-assign ${pickedTeams.size} team${pickedTeams.size === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

// ---- Assignment cards + drag-to-reassign ------------------------------------
type MatchAssign = {
  _id: Id<"assignments">;
  matchNumber: number;
  teamNumber: number;
  memberId: Id<"members">;
  predictedTime: number | null;
  hasReport: boolean;
  dueAt: number | null;
  overdue: boolean;
};
type PitAssign = { _id: Id<"assignments">; teamNumber: number; memberId: Id<"members">; hasReport: boolean };

function AssignCard({
  aid,
  label,
  sub,
  status,
  onRemove,
}: {
  aid: Id<"assignments">;
  label: string;
  sub: string;
  status: "done" | "overdue" | "pending";
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: aid });
  const color = status === "done" ? "#3ecf76" : status === "overdue" ? "#ff5d6c" : "#6b6f78";
  return (
    <div
      ref={setNodeRef}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined, opacity: isDragging ? 0.4 : 1 }}
      className={`flex items-center gap-2 rounded-lg border bg-[#111] px-2.5 py-2 ${
        status === "overdue" ? "border-accent/40" : "border-[#232323]"
      }`}
    >
      <span {...attributes} {...listeners} className="cursor-grab touch-none text-[#4a4f57] active:cursor-grabbing">
        ⠿
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-mono text-[12px] text-[#e7eaf0]">{label}</span>{" "}
        <span className="text-[11px] text-muted">{sub}</span>
      </span>
      <span className="text-[10px]" style={{ color }}>
        {status === "done" ? "✓" : status === "overdue" ? "overdue" : "•"}
      </span>
      <button onClick={onRemove} className="text-[12px] text-muted hover:text-accent">✕</button>
    </div>
  );
}

function ScoutColumn({
  memberId,
  name,
  count,
  overdueCount,
  children,
}: {
  memberId: Id<"members">;
  name: string;
  count: number;
  overdueCount: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `scout:${memberId}` });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border p-3 transition-colors ${isOver ? "border-accent bg-accent/[0.06]" : "border-[#1a1a1a] bg-surface"}`}
    >
      <Collapsible
        defaultOpen={false}
        gap="mb-2"
        header={
          <span className="flex items-center gap-2 text-[14px]">
            <span className="font-medium text-[#e7eaf0]">{name}</span>
            <span className="font-mono text-[11px] text-muted">{count}</span>
            {overdueCount > 0 && (
              <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">{overdueCount} overdue</span>
            )}
          </span>
        }
      >
        <div className="space-y-1.5">
          {count === 0 ? <div className="px-1 py-2 text-[12px] text-[#4a4f57]">No assignments — drag some here.</div> : children}
        </div>
      </Collapsible>
    </div>
  );
}

function MatchAssignments({ id }: { id: Id<"workspaces"> }) {
  const board = useQuery(api.assignments.matchBoard, { workspaceId: id });
  // A reactive query only re-runs when data changes, so re-evaluate lateness
  // against the wall clock here (ticking each minute).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const isOverdue = (a: MatchAssign) =>
    !a.hasReport && a.dueAt != null && a.dueAt < nowMs;
  const reassign = useMutation(api.assignments.reassign);
  const unassign = useMutation(api.assignments.unassign);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (board === undefined) return <div className="text-sm text-muted">Loading…</div>;
  const assigns = board.assignments as MatchAssign[];
  const overdue = assigns.filter(isOverdue);

  function onDragEnd(evt: DragEndEvent) {
    const { active, over } = evt;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("scout:")) return;
    const toMemberId = overId.slice(6) as Id<"members">;
    const a = assigns.find((x) => x._id === active.id);
    if (!a || a.memberId === toMemberId) return;
    reassign({ assignmentId: active.id as Id<"assignments">, toMemberId }).catch((e) => toast.error((e as Error).message));
  }

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <div className="rounded-2xl border border-accent/40 bg-accent/[0.06] p-4">
          <div className="mb-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Overdue reports ({overdue.length})
          </div>
          <div className="space-y-1">
            {overdue.map((a) => (
              <div key={a._id} className="flex items-center justify-between text-[13px]">
                <span>
                  <span className="font-mono">Q{a.matchNumber}</span> · team{" "}
                  <span className="font-mono">{a.teamNumber}</span>
                </span>
                <span className="text-muted">{board.members.find((m) => m._id === a.memberId)?.name ?? "?"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid gap-2 sm:grid-cols-2">
          {board.members.map((m) => {
            const mine = assigns.filter((a) => a.memberId === m._id);
            return (
              <ScoutColumn
                key={m._id}
                memberId={m._id}
                name={m.name}
                count={mine.length}
                overdueCount={mine.filter(isOverdue).length}
              >
                {mine.map((a) => (
                  <AssignCard
                    key={a._id}
                    aid={a._id}
                    label={`Q${a.matchNumber}`}
                    sub={`team ${a.teamNumber}${a.predictedTime ? ` · ~${formatClock(a.predictedTime)}` : ""}`}
                    status={a.hasReport ? "done" : isOverdue(a) ? "overdue" : "pending"}
                    onRemove={() => unassign({ assignmentId: a._id })}
                  />
                ))}
              </ScoutColumn>
            );
          })}
        </div>
      </DndContext>
    </div>
  );
}

function PitAssignments({ id }: { id: Id<"workspaces"> }) {
  const board = useQuery(api.assignments.pitBoard, { workspaceId: id });
  const reassign = useMutation(api.assignments.reassign);
  const unassign = useMutation(api.assignments.unassign);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (board === undefined) return <div className="text-sm text-muted">Loading…</div>;
  const assigns = board.assignments as PitAssign[];

  function onDragEnd(evt: DragEndEvent) {
    const { active, over } = evt;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("scout:")) return;
    const toMemberId = overId.slice(6) as Id<"members">;
    const a = assigns.find((x) => x._id === active.id);
    if (!a || a.memberId === toMemberId) return;
    reassign({ assignmentId: active.id as Id<"assignments">, toMemberId }).catch((e) => toast.error((e as Error).message));
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid gap-2 sm:grid-cols-2">
        {board.members.map((m) => {
          const mine = assigns.filter((a) => a.memberId === m._id);
          return (
            <ScoutColumn key={m._id} memberId={m._id} name={m.name} count={mine.length} overdueCount={0}>
              {mine.map((a) => (
                <AssignCard
                  key={a._id}
                  aid={a._id}
                  label={`${a.teamNumber}`}
                  sub="pit"
                  status={a.hasReport ? "done" : "pending"}
                  onRemove={() => unassign({ assignmentId: a._id })}
                />
              ))}
            </ScoutColumn>
          );
        })}
      </div>
    </DndContext>
  );
}

// ---- Page -------------------------------------------------------------------
function Members({ id }: { id: Id<"workspaces"> }) {
  const data = useQuery(api.workspaces.get, { workspaceId: id });
  const teams = useQuery(api.teams.list, { workspaceId: id });
  const board = useQuery(api.assignments.matchBoard, { workspaceId: id });
  const setFree = useMutation(api.workspaces.setFreeScoutMode);
  const [sub, setSub] = useState<"match" | "pit">("match");

  if (data === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (data === null || data.member.role !== "admin")
    return (
      <div className={`${CARD} text-center text-sm text-muted`}>
        Admins only. <Link href={`/scout/w/${id}`} className="text-accent no-underline">Back</Link>
      </div>
    );

  const free = !!data.workspace.freeScoutMode;
  const members = board?.members ?? [];
  const teamList = (teams ?? []).map((t) => ({ teamNumber: t.teamNumber, name: t.name }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[18px] font-semibold">Members</h2>
        <p className="mt-1 text-[13px] text-muted">
          Manage your workspace roster, delegate scouting, and track overdue reports.
        </p>
      </div>

      <MembersTable id={id} />

      {/* Free scout mode */}
      <div className={`${CARD} flex items-center justify-between gap-3`}>
        <div>
          <div className="text-[14px] font-medium">Free scout mode</div>
          <div className="text-[12px] text-muted">
            When on, scouts can scout any match/team — not just their assignments.
          </div>
        </div>
        <button
          onClick={() => setFree({ workspaceId: id, on: !free })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${free ? "bg-accent" : "bg-[#2a2a2a]"}`}
          aria-pressed={free}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${free ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>

      {/* Assignments */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold">Assignments</h3>
          <div className="flex rounded-xl border border-[#232323] p-0.5 text-[13px]">
            {(["match", "pit"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setSub(k)}
                className={`rounded-lg px-3 py-1.5 capitalize ${sub === k ? "bg-accent/15 text-accent" : "text-muted"}`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        {teamList.length === 0 ? (
          <div className={`${CARD} text-center text-sm text-muted`}>Import an event first (Setup).</div>
        ) : (
          <div className="space-y-4">
            <DelegationPanel key={sub} id={id} kind={sub} teams={teamList} members={members} />
            {sub === "match" ? <MatchAssignments id={id} /> : <PitAssignments id={id} />}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Members id={id as Id<"workspaces">} />;
}
