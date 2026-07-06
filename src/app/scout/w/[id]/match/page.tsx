"use client";

import { use, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";

const CARD = "rounded-2xl border border-[#1a1a1a] bg-surface p-4";
const MALFUNCTIONS = ["drivetrain", "turret", "intake", "shooter"];
const TAGS = ["fast", "accurate", "good driver", "plays defense", "inconsistent"];

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

function Stepper({ label, value, set }: { label: string; value: number; set: (n: number) => void }) {
  return (
    <div className={`${CARD} flex items-center justify-between`}>
      <span className="text-[14px]">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => set(Math.max(0, value - 1))} className="h-9 w-9 rounded-lg border border-[#232323] text-[18px] text-muted hover:border-[#3a3a3a]">
          −
        </button>
        <span className="w-8 text-center text-[18px] font-bold tabular-nums">{value}</span>
        <button type="button" onClick={() => set(value + 1)} className="h-9 w-9 rounded-lg border border-[#232323] text-[18px] text-muted hover:border-[#3a3a3a]">
          +
        </button>
      </div>
    </div>
  );
}

const arr = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function MatchScout({ id }: { id: Id<"workspaces"> }) {
  const schedule = useQuery(api.match.schedule, { workspaceId: id });
  const claim = useMutation(api.match.claim);
  const submit = useMutation(api.match.submitReport);

  const [matchNumber, setMatchNumber] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);

  // form
  const [autoNear, setAutoNear] = useState(false);
  const [autoFar, setAutoFar] = useState(false);
  const [autoLeave, setAutoLeave] = useState(false);
  const [autoUndis, setAutoUndis] = useState(false);
  const [autoArt, setAutoArt] = useState(0);
  const [teleNear, setTeleNear] = useState(false);
  const [teleFar, setTeleFar] = useState(false);
  const [teleArt, setTeleArt] = useState(0);
  const [park, setPark] = useState<"none" | "simple" | "tilt" | "climb">("none");
  const [malf, setMalf] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const state = useQuery(
    api.match.matchState,
    matchNumber != null ? { workspaceId: id, matchNumber } : "skip",
  );
  const match = useMemo(
    () => schedule?.find((m) => m.matchNumber === matchNumber),
    [schedule, matchNumber],
  );

  function resetForm() {
    setAutoNear(false); setAutoFar(false); setAutoLeave(false); setAutoUndis(false); setAutoArt(0);
    setTeleNear(false); setTeleFar(false); setTeleArt(0); setPark("none"); setMalf([]); setNote(""); setTags([]);
  }

  async function pickTeam(n: number) {
    try {
      await claim({ workspaceId: id, matchNumber: matchNumber!, teamNumber: n });
      setTeam(n);
      resetForm();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onSubmit() {
    if (team == null || matchNumber == null) return;
    setBusy(true);
    try {
      await submit({
        workspaceId: id, matchNumber, teamNumber: team,
        autoNearZone: autoNear, autoFarZone: autoFar, autoLeave, autoUndisrupted: autoUndis, autoArtifacts: autoArt,
        teleopNearZone: teleNear, teleopFarZone: teleFar, teleopArtifacts: teleArt,
        park, malfunctions: malf, malfunctionNote: note || undefined, tags,
      });
      toast.success(`Saved Q${matchNumber} · ${team}`);
      setTeam(null);
      resetForm();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (schedule === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (schedule.length === 0)
    return <div className={`${CARD} text-center text-sm text-muted`}>No schedule imported yet.</div>;

  const claimedBy = (n: number) => state?.claims.find((c) => c.teamNumber === n);
  const reported = (n: number) => state?.reportedTeams.includes(n);

  return (
    <div className="space-y-4">
      <h2 className="text-[18px] font-semibold">Match scouting</h2>

      {/* Match selector */}
      <select
        value={matchNumber ?? ""}
        onChange={(e) => {
          setMatchNumber(e.target.value ? Number(e.target.value) : null);
          setTeam(null);
        }}
        className="w-full rounded-xl border border-[#232323] bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-[#3a3a3a]"
      >
        <option value="">Select a qualification match…</option>
        {schedule.map((m) => (
          <option key={m.matchNumber} value={m.matchNumber}>
            Q{m.matchNumber}
          </option>
        ))}
      </select>

      {/* Team picker */}
      {match && team == null && (
        <div className="grid grid-cols-2 gap-2">
          {[...match.red.map((n) => ["red", n] as const), ...match.blue.map((n) => ["blue", n] as const)].map(
            ([side, n]) => {
              const c = claimedBy(n);
              const done = reported(n);
              const disabled = done || (c && true);
              return (
                <button
                  key={n}
                  disabled={!!disabled}
                  onClick={() => pickTeam(n)}
                  className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${
                    side === "red" ? "border-red/40" : "border-blue/40"
                  } ${disabled ? "" : "hover:bg-[#101010]"}`}
                  style={{ borderColor: side === "red" ? "rgba(255,93,108,0.4)" : "rgba(77,141,255,0.4)" }}
                >
                  <div className="font-mono text-[15px] font-bold">{n}</div>
                  <div className="text-[11px] text-muted">
                    {done ? "reported" : c ? `taken · ${c.by}` : "tap to scout"}
                  </div>
                </button>
              );
            },
          )}
        </div>
      )}

      {/* Form */}
      {match && team != null && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold">
              Q{matchNumber} · Team <span className="font-mono">{team}</span>
            </div>
            <button
              onClick={() => setTeam(null)}
              className="text-[13px] text-muted hover:text-foreground"
            >
              change
            </button>
          </div>

          <section>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Autonomous</div>
            <div className="grid grid-cols-2 gap-2">
              <Toggle on={autoNear} onClick={() => setAutoNear(!autoNear)}>Near zone</Toggle>
              <Toggle on={autoFar} onClick={() => setAutoFar(!autoFar)}>Far zone</Toggle>
              <Toggle on={autoLeave} onClick={() => setAutoLeave(!autoLeave)}>Leave</Toggle>
              <Toggle on={autoUndis} onClick={() => setAutoUndis(!autoUndis)}>Undisrupted</Toggle>
            </div>
            <div className="mt-2"><Stepper label="Auto artifacts" value={autoArt} set={setAutoArt} /></div>
          </section>

          <section>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">TeleOp</div>
            <div className="grid grid-cols-2 gap-2">
              <Toggle on={teleNear} onClick={() => setTeleNear(!teleNear)}>Near zone</Toggle>
              <Toggle on={teleFar} onClick={() => setTeleFar(!teleFar)}>Far zone</Toggle>
            </div>
            <div className="mt-2"><Stepper label="TeleOp artifacts" value={teleArt} set={setTeleArt} /></div>
          </section>

          <section>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Endgame park</div>
            <div className="grid grid-cols-4 gap-2">
              {(["none", "simple", "tilt", "climb"] as const).map((p) => (
                <Toggle key={p} on={park === p} onClick={() => setPark(p)}>{p}</Toggle>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Malfunctions</div>
            <div className="grid grid-cols-2 gap-2">
              {MALFUNCTIONS.map((m) => (
                <Toggle key={m} on={malf.includes(m)} onClick={() => setMalf(arr(malf, m))}>{m}</Toggle>
              ))}
            </div>
            {malf.length > 0 && (
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Short note (optional)"
                className="mt-2 w-full rounded-xl border border-[#232323] bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3a3a3a]"
              />
            )}
          </section>

          <section>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Tags</div>
            <div className="flex flex-wrap gap-2">
              {TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTags(arr(tags, t))}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                    tags.includes(t) ? "border-accent bg-accent/15 text-accent" : "border-[#232323] text-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>

          <button
            onClick={onSubmit}
            disabled={busy}
            className="w-full rounded-xl bg-accent px-4 py-3.5 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Submit report"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <MatchScout id={id as Id<"workspaces">} />;
}
