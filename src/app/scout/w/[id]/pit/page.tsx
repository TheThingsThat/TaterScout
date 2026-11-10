"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { errorMessage } from "@/lib/scoutError";
import { compressPhoto, decodeStrokes, encodeStrokes, type Stroke } from "@/lib/autoDraw";
import { AutoEditor } from "@/components/scout/AutoDrawing";

type RobotStatus = "full" | "minor" | "major";

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-[14px] transition-colors ${
        on ? "border-accent bg-accent/15 text-foreground" : "border-border-strong text-muted hover:border-border-hover"
      }`}
    >
      {children}
    </button>
  );
}

function ModalShell({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  // Close on the backdrop only for a press that began there too: a drag that ends
  // outside the sheet (drawing, selecting notes) mustn't throw the form away.
  const pressedBackdrop = useRef(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl border border-border-strong bg-input p-5 sm:rounded-2xl"
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

type PitReport = NonNullable<FunctionReturnType<typeof api.pit.get>>;
type AutoDraft = { name: string; side: "red" | "blue"; strokes: Stroke[] };
const MAX_AUTOS = 4;

const LABEL = "mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted";

/** Two or three mutually exclusive choices. */
function Choice<T extends string | boolean>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={`grid gap-2 ${options.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {options.map(([v, label]) => (
        <Toggle key={String(v)} on={value === v} onClick={() => onChange(v)}>
          {label}
        </Toggle>
      ))}
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
  initial: PitReport | null;
  onClose: () => void;
}) {
  const savePit = useAction(api.pit.save);
  const [hasAuto, setHasAuto] = useState<boolean | null>(initial?.hasAuto ?? null);
  const [autos, setAutos] = useState<AutoDraft[]>(
    (initial?.autos ?? []).map((a) => ({ name: a.name, side: a.side, strokes: decodeStrokes(a.strokes) })),
  );
  const [flower, setFlower] = useState<boolean | null>(initial?.flower ?? null);
  const [scoring, setScoring] = useState<"pollen" | "pollenNectar" | null>(initial?.scoring ?? null);
  // Photo: the saved one, a newly picked one (uploaded on Save), or removed.
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [robotStatus, setRobotStatus] = useState<RobotStatus>(initial?.robotStatus ?? "full");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const shownPhoto = photo?.preview ?? (photoRemoved ? null : (initial?.photoUrl ?? null));
  const missing = [hasAuto === null && "auto", flower === null && "flower", scoring === null && "scoring"].filter(Boolean);

  function chooseAuto(v: boolean) {
    setHasAuto(v);
    if (v && autos.length === 0) setAutos([{ name: "", side: "red", strokes: [] }]);
  }
  const setAuto = (i: number, patch: Partial<AutoDraft>) =>
    setAutos((list) => list.map((a, k) => (k === i ? { ...a, ...patch } : a)));

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const blob = await compressPhoto(file);
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
      setPhotoRemoved(false);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't read that photo"));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save() {
    if (missing.length) return toast.error("Answer auto, flower and scoring first.");
    if (photoBusy) return;
    // The server's limits, checked here first so the message names the drawing.
    const encoded = autos.map((a, i) => ({ name: a.name.trim() || `Auto ${i + 1}`, side: a.side, strokes: encodeStrokes(a.strokes) }));
    if (hasAuto) {
      const heavy = encoded.findIndex((a, i) => autos[i].strokes.length > 80 || a.strokes.length > 40_000);
      if (heavy >= 0) return toast.error(`${encoded[heavy].name} has too many lines. Erase a few and save again.`);
    }
    setBusy(true);
    try {
      await savePit({
        workspaceId,
        teamNumber,
        hasAuto: hasAuto!,
        autos: hasAuto ? encoded : [],
        flower: flower!,
        scoring: scoring!,
        photo: photo ? await photo.blob.arrayBuffer() : photoRemoved ? null : undefined,
        robotStatus,
        notes: notes || undefined,
      });
      toast.success(`Saved pit scout · ${teamNumber}`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the pit report"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-5">
      <section>
        <div className={LABEL}>Autonomous</div>
        <Choice value={hasAuto} options={[[true, "Has an auto"], [false, "No auto"]] as const} onChange={chooseAuto} />
        {hasAuto && (
          <div className="mt-3 space-y-4">
            {autos.map((a, i) => (
              <div key={i} className="rounded-2xl border border-border p-3">
                <div className="mb-2.5 flex items-center gap-2">
                  <input
                    value={a.name}
                    onChange={(e) => setAuto(i, { name: e.target.value })}
                    maxLength={40}
                    placeholder={`Auto ${i + 1} name (e.g. Left 2-tip)`}
                    className="min-w-0 flex-1 rounded-lg border border-border-strong bg-surface px-3 py-2 text-[14px] outline-none focus:border-border-hover"
                  />
                  {(["red", "blue"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setAuto(i, { side })}
                      className="rounded-lg border px-2.5 py-2 text-[12px] font-semibold capitalize"
                      style={
                        a.side === side
                          ? { borderColor: side === "red" ? "var(--red)" : "var(--blue)", color: side === "red" ? "var(--red)" : "var(--blue)" }
                          : { borderColor: "var(--border-strong)", color: "var(--dim)" }
                      }
                    >
                      {side}
                    </button>
                  ))}
                </div>
                <AutoEditor value={a.strokes} onChange={(strokes) => setAuto(i, { strokes })} />
                {autos.length > 1 && (
                  <button
                    type="button"
                    onClick={() => confirm(`Remove ${a.name.trim() || `Auto ${i + 1}`}?`) && setAutos((l) => l.filter((_, k) => k !== i))}
                    className="mt-1 text-[12px] text-accent hover:underline"
                  >
                    Remove this auto
                  </button>
                )}
              </div>
            ))}
            {autos.length < MAX_AUTOS && (
              <button
                type="button"
                onClick={() => setAutos((l) => [...l, { name: "", side: l.at(-1)?.side ?? "red", strokes: [] }])}
                className="w-full rounded-xl border border-dashed border-border-strong py-3 text-[14px] text-muted hover:border-border-hover hover:text-foreground"
              >
                + Add another auto
              </button>
            )}
          </div>
        )}
      </section>

      <section>
        <div className={LABEL}>Can score in flowers</div>
        <Choice value={flower} options={[[true, "Yes"], [false, "No"]] as const} onChange={setFlower} />
      </section>

      <section>
        <div className={LABEL}>Scores</div>
        <Choice
          value={scoring}
          options={[["pollen", "Pollen only"], ["pollenNectar", "Pollen + nectar"]] as const}
          onChange={setScoring}
        />
      </section>

      <section>
        <div className={LABEL}>Robot photo (optional)</div>
        {shownPhoto ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview or a Convex file URL */}
            <img src={shownPhoto} alt={`Team ${teamNumber} robot`} className="h-24 w-24 rounded-xl object-cover" />
            <div className="flex flex-col gap-2 text-[13px]">
              <label className="cursor-pointer text-accent hover:underline">
                Replace
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
              </label>
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  setPhotoRemoved(true);
                }}
                className="text-left text-muted hover:text-foreground"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <label className="flex h-14 cursor-pointer items-center justify-center rounded-xl border border-border-strong text-[14px] text-muted hover:border-border-hover hover:text-foreground">
            Take or choose a photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
          </label>
        )}
      </section>

      <section>
        <div className={LABEL}>Robot status</div>
        <div className="grid grid-cols-3 gap-2">
          {([["full", "Fully functioning"], ["minor", "Minor issues"], ["major", "Major issues"]] as const).map(
            ([val, label]) => (
              <Toggle key={val} on={robotStatus === val} onClick={() => setRobotStatus(val)}>{label}</Toggle>
            ),
          )}
        </div>
      </section>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="Additional notes (optional)"
        className="w-full rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-border-hover"
      />

      <button
        onClick={save}
        disabled={busy || photoBusy}
        className="w-full rounded-xl bg-accent px-4 py-3 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Saving…" : photoBusy ? "Processing photo…" : missing.length ? `Answer ${missing.join(", ")} to save` : "Save"}
      </button>
    </div>
  );
}

function PitForm({ workspaceId, teamNumber, onClose }: { workspaceId: Id<"workspaces">; teamNumber: number; onClose: () => void }) {
  const existing = useQuery(api.pit.get, { workspaceId, teamNumber });
  // Any tap or typing inside the form counts as unsaved work worth asking about.
  const touched = useRef(false);
  const close = () => (!touched.current || confirm("Close without saving this pit report?")) && onClose();
  return (
    <ModalShell title={<>Pit scout · <span className="font-mono">{teamNumber}</span></>} onClose={close}>
      {existing === undefined ? (
        <div className="py-8 text-center text-sm text-muted">Loading…</div>
      ) : (
        <div
          onPointerDownCapture={() => (touched.current = true)}
          onInputCapture={() => (touched.current = true)}
        >
          <PitFormInner workspaceId={workspaceId} teamNumber={teamNumber} initial={existing} onClose={onClose} />
        </div>
      )}
    </ModalShell>
  );
}

const STATUS_LABEL: Record<string, string> = { full: "OK", minor: "Minor", major: "Major" };
const STATUS_CLASS: Record<string, string> = { full: "text-teal", minor: "text-gold", major: "text-accent" };

function Pit({ id }: { id: Id<"workspaces"> }) {
  const data = useQuery(api.workspaces.get, { workspaceId: id });
  // Member-gated queries throw for a non-member; wait until get() confirms access.
  const ok = data ? { workspaceId: id } : "skip";
  const teams = useQuery(api.teams.pitStatus, ok);
  const mine = useQuery(api.assignments.mySchedule, ok);
  const [selected, setSelected] = useState<number | null>(null);

  if (data === null)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
        No access. <Link href="/scout" className="text-accent no-underline">Back</Link>
      </div>
    );
  if (teams === undefined || data === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (teams.length === 0)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
        No teams yet — import the event first (Setup).
      </div>
    );

  const canSeeAll = data?.member.role === "admin" || !!data?.workspace.freeScoutMode;
  const assignedPit = new Set((mine?.pit ?? []).map((a) => a.teamNumber));
  const visibleTeams = canSeeAll ? teams : teams.filter((t) => assignedPit.has(t.teamNumber));
  const scouted = visibleTeams.filter((t) => t.pitScouted).length;

  if (!canSeeAll && visibleTeams.length === 0)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
        No pit teams assigned to you yet. An admin assigns pit scouting on the Members page.
      </div>
    );

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold">Pit scouting{!canSeeAll ? " · assigned" : ""}</h2>
        <span className="text-[13px] text-muted">{scouted}/{visibleTeams.length} scouted</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visibleTeams.map((t) => (
          <button
            key={t._id}
            onClick={() => setSelected(t.teamNumber)}
            className={`rounded-xl border p-3 text-left transition-colors hover:bg-hover ${
              t.pitScouted ? "border-teal/20 bg-teal/[0.04]" : "border-border-strong"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[14px] font-bold">{t.teamNumber}</span>
              {t.pitScouted ? (
                <span className={`text-[10px] ${STATUS_CLASS[t.robotStatus ?? "full"]}`}>
                  ✓ {STATUS_LABEL[t.robotStatus ?? "full"]}
                </span>
              ) : (
                <span className="text-[10px] text-faint">not scouted</span>
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
