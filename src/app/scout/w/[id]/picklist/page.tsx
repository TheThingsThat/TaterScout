"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";

const COLUMNS = [
  { tier: "t1", label: "Tier 1" },
  { tier: "t2", label: "Tier 2" },
  { tier: "t3", label: "Tier 3" },
  { tier: "dnp", label: "Do Not Pick" },
  { tier: "uncat", label: "Uncategorized" },
] as const;
type Tier = (typeof COLUMNS)[number]["tier"];

type Entry = { _id: Id<"picklistEntries">; teamNumber: number; name: string; tier: string; rank: number };

function Card({ entry, editable }: { entry: Entry; editable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry._id,
    disabled: !editable,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      className={`rounded-lg border border-[#232323] bg-[#111] px-3 py-2 ${editable ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] text-muted">{entry.teamNumber}</span>
        <span className="min-w-0 truncate text-[13px] text-[#e7eaf0]">{entry.name}</span>
      </div>
    </div>
  );
}

function Column({ tier, label, entries, editable }: { tier: Tier; label: string; entries: Entry[]; editable: boolean }) {
  const { setNodeRef } = useDroppable({ id: `col:${tier}` });
  return (
    <div className="flex w-[220px] shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{label}</span>
        <span className="text-[11px] text-[#4a4f57]">{entries.length}</span>
      </div>
      <div ref={setNodeRef} className="min-h-[120px] space-y-2 rounded-xl border border-[#161616] bg-surface/50 p-2">
        <SortableContext items={entries.map((e) => e._id)} strategy={verticalListSortingStrategy}>
          {entries.map((e) => (
            <Card key={e._id} entry={e} editable={editable} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

function Board({ id }: { id: Id<"workspaces"> }) {
  const [kind, setKind] = useState<"personal" | "primary">("personal");
  const board = useQuery(api.picklist.board, { workspaceId: id, kind });
  const ensure = useMutation(api.picklist.ensure);
  const move = useMutation(api.picklist.moveEntry);
  const merge = useMutation(api.picklist.mergeIntoPrimary);
  const membership = useQuery(api.workspaces.get, { workspaceId: id });
  const [merging, setMerging] = useState(false);

  const isAdmin = membership?.member.role === "admin";

  async function onMerge() {
    if (!confirm("Merge everyone's personal boards into Primary? This replaces the current Primary board.")) return;
    setMerging(true);
    try {
      const r = await merge({ workspaceId: id });
      toast.success(`Merged ${r.mergedBoards} board${r.mergedBoards === 1 ? "" : "s"} into Primary`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMerging(false);
    }
  }

  // Ensure entries exist (personal for anyone; primary only for admin).
  useEffect(() => {
    if (kind === "personal" || isAdmin) {
      ensure({ workspaceId: id, kind }).catch(() => {});
    }
  }, [id, kind, isAdmin, ensure]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (board === undefined) return <div className="text-sm text-muted">Loading…</div>;

  const editable = board.editable;
  const entries = board.entries as Entry[];
  const grouped: Record<Tier, Entry[]> = { t1: [], t2: [], t3: [], dnp: [], uncat: [] };
  for (const e of entries) (grouped[e.tier as Tier] ?? grouped.uncat).push(e);

  function onDragEnd(evt: DragEndEvent) {
    const { active, over } = evt;
    if (!over) return;
    const activeId = active.id as Id<"picklistEntries">;
    let toTier: Tier;
    let toIndex: number;
    const overId = String(over.id);
    if (overId.startsWith("col:")) {
      toTier = overId.slice(4) as Tier;
      toIndex = grouped[toTier].length;
    } else {
      const overEntry = entries.find((e) => e._id === over.id);
      if (!overEntry) return;
      toTier = overEntry.tier as Tier;
      toIndex = grouped[toTier].findIndex((e) => e._id === over.id);
    }
    if (over.id === active.id) return;
    move({ entryId: activeId, toTier, toIndex }).catch(() => {});
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[18px] font-semibold">Pick list</h2>
        <div className="flex rounded-xl border border-[#232323] p-0.5 text-[13px]">
          {(["personal", "primary"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg px-3 py-1.5 ${kind === k ? "bg-accent/15 text-accent" : "text-muted"}`}
            >
              {k === "personal" ? "My board" : "Primary"}
            </button>
          ))}
        </div>
      </div>

      {kind === "primary" && !editable && (
        <p className="text-[12px] text-[#6b6f78]">Primary board is admin-only — view only for you.</p>
      )}
      {kind === "primary" && editable && (
        <button
          onClick={onMerge}
          disabled={merging}
          className="rounded-xl border border-[#232323] px-3.5 py-2 text-[13px] text-muted transition-colors hover:border-[#3a3a3a] hover:text-foreground disabled:opacity-60"
        >
          {merging ? "Merging…" : "Merge everyone's boards → consensus"}
        </button>
      )}

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-[#1a1a1a] bg-surface p-6 text-center text-sm text-muted">
          {kind === "primary" && !isAdmin ? "The admin hasn't set up the primary board yet." : "No teams — import the event first (Setup)."}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {COLUMNS.map((c) => (
              <Column key={c.tier} tier={c.tier} label={c.label} entries={grouped[c.tier]} editable={editable} />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}

export default function PicklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Board id={id as Id<"workspaces">} />;
}
