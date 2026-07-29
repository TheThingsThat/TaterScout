"use client";

import { use, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { fmt } from "@/lib/format";

// ---- Ranking field metadata -------------------------------------------------
type CatField = "autoZone" | "teleopZone" | "endgame";
type NumField = "epa" | "oprNp" | "rank" | "reportCount";
type SortField = NumField | "teamNumber";

const CAT_OPTIONS: Record<CatField, string[]> = {
  autoZone: ["far", "near", "none"],
  teleopZone: ["far", "near", "none"],
  endgame: ["park", "tilt", "climb", "none"],
};
const FIELD_LABEL: Record<string, string> = {
  autoZone: "Auto zone",
  teleopZone: "Teleop zone",
  endgame: "Endgame",
  epa: "EPA",
  oprNp: "OPR",
  rank: "Qual rank",
  reportCount: "Reports",
  teamNumber: "Team #",
};

type TeamRow = {
  teamNumber: number;
  name: string;
  rank: number | null;
  epa: number | null;
  oprNp: number | null;
  reportCount: number;
  autoZone: string | null;
  teleopZone: string | null;
  endgame: string | null;
};

type Filter =
  | { id: number; field: CatField; op: "is" | "isNot"; value: string }
  | { id: number; field: NumField; op: "gte" | "lte"; value: string };

const isCat = (f: string): f is CatField =>
  f === "autoZone" || f === "teleopZone" || f === "endgame";

function passes(t: TeamRow, f: Filter): boolean {
  if (isCat(f.field)) {
    const v = t[f.field];
    return f.op === "is" ? v === f.value : v !== f.value;
  }
  // A blank or non-numeric threshold means "not configured yet" — treat the
  // filter as inactive rather than excluding every team (Number("") is 0).
  if (f.value.trim() === "") return true;
  const target = Number(f.value);
  if (Number.isNaN(target)) return true;
  const v = t[f.field];
  if (v == null) return false;
  return (f as { op: string }).op === "gte" ? v >= target : v <= target;
}

const ZONE_CLASS: Record<string, string> = {
  far: "bg-teal/15 text-teal",
  near: "bg-[#2f8bff]/15 text-[#4d8dff]",
  climb: "bg-teal/15 text-teal",
  tilt: "bg-gold/15 text-gold",
  park: "bg-[#2f8bff]/15 text-[#4d8dff]",
  none: "bg-[#161616] text-[#6b6f78]",
};
function Chip({ v }: { v: string | null }) {
  if (!v) return <span className="text-[#3a3f48]">—</span>;
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${ZONE_CLASS[v] ?? ""}`}>{v}</span>;
}

// ---- Ranking tab ------------------------------------------------------------
function RankingView({ teams }: { teams: TeamRow[] }) {
  const [filters, setFilters] = useState<Filter[]>([]);
  const [combine, setCombine] = useState<"and" | "or">("and");
  const [sortField, setSortField] = useState<SortField>("epa");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [nextId, setNextId] = useState(1);

  const ranked = useMemo(() => {
    const filtered = teams.filter((t) => {
      if (filters.length === 0) return true;
      return combine === "and" ? filters.every((f) => passes(t, f)) : filters.some((f) => passes(t, f));
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const an = av == null ? (sortDir === "asc" ? Infinity : -Infinity) : av;
      const bn = bv == null ? (sortDir === "asc" ? Infinity : -Infinity) : bv;
      if (an !== bn) return (an - bn) * dir;
      return a.teamNumber - b.teamNumber;
    });
  }, [teams, filters, combine, sortField, sortDir]);

  function addFilter() {
    setFilters([...filters, { id: nextId, field: "teleopZone", op: "is", value: "far" }]);
    setNextId(nextId + 1);
  }
  function updateFilter(id: number, patch: Partial<Filter>) {
    setFilters(filters.map((f) => (f.id === id ? ({ ...f, ...patch } as Filter) : f)));
  }
  function changeField(id: number, field: string) {
    if (isCat(field)) {
      updateFilter(id, { field, op: "is", value: CAT_OPTIONS[field][0] } as Partial<Filter>);
    } else {
      updateFilter(id, { field: field as NumField, op: "gte", value: "0" } as Partial<Filter>);
    }
  }

  const SELECT = "rounded-lg border border-[#232323] bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-[#3a3a3a]";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-2xl border border-[#1a1a1a] bg-surface p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Filters</span>
          {filters.length > 1 && (
            <div className="flex rounded-lg border border-[#232323] p-0.5 text-[12px]">
              {(["and", "or"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCombine(c)}
                  className={`rounded-md px-2.5 py-0.5 uppercase ${combine === c ? "bg-[#1c1c1c] text-foreground" : "text-muted"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          {filters.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2">
              <select value={f.field} onChange={(e) => changeField(f.id, e.target.value)} className={SELECT}>
                {Object.keys(CAT_OPTIONS).concat(["epa", "oprNp", "rank", "reportCount"]).map((k) => (
                  <option key={k} value={k}>{FIELD_LABEL[k]}</option>
                ))}
              </select>
              {isCat(f.field) ? (
                <>
                  <select value={f.op} onChange={(e) => updateFilter(f.id, { op: e.target.value as "is" | "isNot" })} className={SELECT}>
                    <option value="is">is</option>
                    <option value="isNot">is not</option>
                  </select>
                  <select value={f.value} onChange={(e) => updateFilter(f.id, { value: e.target.value })} className={SELECT}>
                    {CAT_OPTIONS[f.field].map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <select value={f.op} onChange={(e) => updateFilter(f.id, { op: e.target.value as "gte" | "lte" })} className={SELECT}>
                    <option value="gte">≥</option>
                    <option value="lte">≤</option>
                  </select>
                  <input
                    value={f.value}
                    onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                    inputMode="decimal"
                    className={`${SELECT} w-20`}
                  />
                </>
              )}
              <button onClick={() => setFilters(filters.filter((x) => x.id !== f.id))} className="text-[13px] text-muted hover:text-accent">
                ✕
              </button>
            </div>
          ))}
        </div>
        <button onClick={addFilter} className="mt-2 text-[13px] text-accent hover:underline">
          + Add filter
        </button>
      </div>

      {/* Sort */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Sort</span>
        <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)} className={SELECT}>
          {(["epa", "oprNp", "rank", "reportCount", "teamNumber"] as const).map((k) => (
            <option key={k} value={k}>{FIELD_LABEL[k]}</option>
          ))}
        </select>
        <div className="flex rounded-lg border border-[#232323] p-0.5 text-[12px]">
          {(["desc", "asc"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setSortDir(d)}
              className={`rounded-md px-2.5 py-1 ${sortDir === d ? "bg-[#1c1c1c] text-foreground" : "text-muted"}`}
            >
              {d === "desc" ? "↓ high" : "↑ low"}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[12px] text-muted">{ranked.length} teams</span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
        <div className="ts-scroll overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[#1f1f1f] text-[10px] uppercase tracking-[0.1em] text-[#6b6f78]">
                <th className="px-3 py-2.5 text-left font-mono">#</th>
                <th className="px-3 py-2.5 text-left font-mono">Team</th>
                <th className="px-2 py-2.5 text-right font-mono" style={{ color: "#2f8bff" }}>EPA</th>
                <th className="px-2 py-2.5 text-right font-mono" style={{ color: "#3ecf76" }}>OPR</th>
                <th className="px-2 py-2.5 text-center font-mono">Auto</th>
                <th className="px-2 py-2.5 text-center font-mono">Tele</th>
                <th className="px-2 py-2.5 text-center font-mono">End</th>
                <th className="px-2 py-2.5 text-right font-mono">Rpt</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((t, i) => (
                <tr key={t.teamNumber} className="border-b border-[#141414] last:border-0 hover:bg-[#101010]">
                  <td className="px-3 py-2.5 font-mono text-[#6b6f78]">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[#6b6f78]">{t.teamNumber}</span>{" "}
                    <span className="font-medium text-[#e7eaf0]">{t.name}</span>
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums" style={{ color: "#2f8bff" }}>{fmt(t.epa)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: "#3ecf76" }}>{fmt(t.oprNp)}</td>
                  <td className="px-2 py-2.5 text-center"><Chip v={t.autoZone} /></td>
                  <td className="px-2 py-2.5 text-center"><Chip v={t.teleopZone} /></td>
                  <td className="px-2 py-2.5 text-center"><Chip v={t.endgame} /></td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-muted">{t.reportCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Shortlist tab ----------------------------------------------------------
type ShortEntry = { _id: Id<"shortlist">; teamNumber: number; name: string; epa: number | null };

function SortableRow({ entry, index, onRemove }: { entry: ShortEntry; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry._id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-2.5 rounded-lg border border-[#232323] bg-[#111] px-3 py-2.5"
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-[#4a4f57] active:cursor-grabbing"
        title="Drag to reorder"
      >
        ⠿
      </span>
      <span className="w-6 text-center font-mono text-[12px] text-muted">{index + 1}</span>
      <span className="font-mono text-[12px] text-[#6b6f78]">{entry.teamNumber}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-[#e7eaf0]">{entry.name}</span>
      <span className="text-[12px] tabular-nums" style={{ color: "#2f8bff" }}>{fmt(entry.epa)}</span>
      <button onClick={onRemove} className="text-[14px] text-muted hover:text-accent">✕</button>
    </div>
  );
}

function ShortlistView({ id, teams }: { id: Id<"workspaces">; teams: TeamRow[] }) {
  const entries = useQuery(api.shortlist.list, { workspaceId: id });
  const add = useMutation(api.shortlist.add);
  const remove = useMutation(api.shortlist.remove);
  const move = useMutation(api.shortlist.move);
  const [q, setQ] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const list = (entries ?? []) as ShortEntry[];
  const onList = new Set(list.map((e) => e.teamNumber));
  const matches = q.trim()
    ? teams
        .filter((t) => !onList.has(t.teamNumber) && `${t.teamNumber} ${t.name}`.toLowerCase().includes(q.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  function onDragEnd(evt: DragEndEvent) {
    const { active, over } = evt;
    if (!over || active.id === over.id) return;
    const from = list.findIndex((e) => e._id === active.id);
    const to = list.findIndex((e) => e._id === over.id);
    if (from < 0 || to < 0) return;
    // Server recomputes the fractional rank; the query re-sorts reactively.
    move({ entryId: active.id as Id<"shortlist">, toIndex: to }).catch((e) => toast.error((e as Error).message));
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Add a team by number or name…"
          className="w-full rounded-xl border border-[#232323] bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3a3a3a]"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-[#232323] bg-[#0c0c0c]">
            {matches.map((t) => (
              <button
                key={t.teamNumber}
                onClick={async () => {
                  await add({ workspaceId: id, teamNumber: t.teamNumber });
                  setQ("");
                }}
                className="flex w-full items-center gap-2 border-t border-[#141414] px-3.5 py-2.5 text-left first:border-t-0 hover:bg-[#101010]"
              >
                <span className="font-mono text-[12px] text-muted">{t.teamNumber}</span>
                <span className="truncate text-[13px] text-foreground">{t.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {entries === undefined ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-[#1a1a1a] bg-surface p-6 text-center text-sm text-muted">
          Your shortlist is empty. Search above to add teams, then drag to rank them.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={list.map((e) => e._id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {list.map((e, i) => (
                <SortableRow key={e._id} entry={e} index={i} onRemove={() => remove({ entryId: e._id })} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <p className="text-[11px] text-[#6b6f78]">Your shortlist is private — only you can see it.</p>
    </div>
  );
}

// ---- Page -------------------------------------------------------------------
function Picklist({ id }: { id: Id<"workspaces"> }) {
  const teamsData = useQuery(api.picklist.teams, { workspaceId: id });
  const [tab, setTab] = useState<"rank" | "shortlist">("rank");

  if (teamsData === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (teamsData.length === 0)
    return (
      <div className="rounded-2xl border border-[#1a1a1a] bg-surface p-6 text-center text-sm text-muted">
        No teams yet — an admin needs to import the event (Setup).
      </div>
    );
  const teams = teamsData as TeamRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[18px] font-semibold">Pick list</h2>
        <div className="flex rounded-xl border border-[#232323] p-0.5 text-[13px]">
          {(["rank", "shortlist"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 ${tab === k ? "bg-accent/15 text-accent" : "text-muted"}`}
            >
              {k === "rank" ? "Ranking" : "Shortlist"}
            </button>
          ))}
        </div>
      </div>
      {tab === "rank" ? <RankingView teams={teams} /> : <ShortlistView id={id} teams={teams} />}
    </div>
  );
}

export default function PicklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Picklist id={id as Id<"workspaces">} />;
}
