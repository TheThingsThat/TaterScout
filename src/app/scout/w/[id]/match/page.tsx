"use client";

import { use, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { errorMessage } from "@/lib/scoutError";

const CARD = "rounded-2xl border border-[#1a1a1a] bg-surface p-4";
const MALFUNCTIONS = ["drivetrain", "turret", "intake", "shooter"];
const TAGS = ["fast", "accurate", "good driver", "plays defense", "inconsistent"];

type Zone = "far" | "near" | "none";
type Endgame = "park" | "tilt" | "climb" | "none";

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-[14px] capitalize transition-colors ${
        on ? "border-accent bg-accent/15 text-foreground" : "border-[#232323] text-muted hover:border-[#3a3a3a]"
      }`}
    >
      {children}
    </button>
  );
}

// Single-select group (mutually exclusive).
function Radio<T extends string>({ options, value, set }: { options: readonly T[]; value: T; set: (v: T) => void }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <Toggle key={o} on={value === o} onClick={() => set(o)}>
          {o}
        </Toggle>
      ))}
    </div>
  );
}

function Stepper({ label, value, set, onTally }: { label: string; value: number; set: (n: number) => void; onTally?: () => void }) {
  return (
    <div className={`${CARD} flex items-center justify-between`}>
      <span className="text-[14px]">{label}</span>
      <div className="flex items-center gap-2.5">
        {onTally && (
          <button
            type="button"
            onClick={onTally}
            className="rounded-lg border border-[#232323] px-2.5 py-2 text-[12px] text-muted hover:border-[#3a3a3a] hover:text-foreground"
            title="Tally mode — big +/- buttons"
          >
            Tally
          </button>
        )}
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

// Full-screen tally counter (built for mobile): the bottom 3/4 is one big "+1"
// tap zone, the top 1/4 is "-1". The running count sits on the boundary.
function TallyOverlay({
  label,
  value,
  inc,
  dec,
  onClose,
}: {
  label: string;
  value: number;
  inc: () => void;
  dec: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex select-none flex-col bg-[#0a0a0a]">
      {/* Top 1/4 — tap anywhere to subtract one. */}
      <button
        type="button"
        onClick={dec}
        className="flex h-1/4 items-center justify-center gap-3 bg-[#170f0f] transition-colors active:bg-[#2a1414]"
      >
        <span className="text-[56px] font-bold leading-none text-accent">−</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#7a5a5a]">tap to −1</span>
      </button>
      {/* Bottom 3/4 — the count lives here; tap anywhere to add one. */}
      <button
        type="button"
        onClick={inc}
        className="flex h-3/4 flex-col items-center justify-center gap-1 bg-[#0c130d] transition-colors active:bg-[#132a17]"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>
        <span className="text-[128px] font-bold leading-none tabular-nums text-foreground">{value}</span>
        <span className="mt-2 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-teal">
          <span className="text-[28px] leading-none">+</span> tap to add
        </span>
      </button>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full border border-[#333] bg-black/50 px-4 py-2 text-[14px] font-medium text-foreground backdrop-blur"
      >
        Done
      </button>
    </div>
  );
}

const arr = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function MatchScout({ id }: { id: Id<"workspaces"> }) {
  const data = useQuery(api.workspaces.get, { workspaceId: id });
  const schedule = useQuery(api.match.schedule, { workspaceId: id });
  const mine = useQuery(api.assignments.mySchedule, { workspaceId: id });
  const claim = useMutation(api.match.claim);
  const unclaim = useMutation(api.match.unclaim);
  const submit = useMutation(api.match.submitReport);

  const [matchNumber, setMatchNumber] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filterTeams, setFilterTeams] = useState<number[]>([]);

  // form
  const [autoZone, setAutoZone] = useState<Zone>("none");
  const [autoLeave, setAutoLeave] = useState(false);
  const [autoUndis, setAutoUndis] = useState(false);
  const [autoArt, setAutoArt] = useState(0);
  const [teleZone, setTeleZone] = useState<Zone>("none");
  const [teleArt, setTeleArt] = useState(0);
  const [endgame, setEndgame] = useState<Endgame>("none");
  const [malf, setMalf] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tally, setTally] = useState<null | "auto" | "teleop">(null);

  const state = useQuery(
    api.match.matchState,
    matchNumber != null ? { workspaceId: id, matchNumber } : "skip",
  );
  const match = useMemo(
    () => schedule?.find((m) => m.matchNumber === matchNumber),
    [schedule, matchNumber],
  );

  const isAdmin = data?.member.role === "admin";
  const canSeeAll = isAdmin || !!data?.workspace.freeScoutMode;

  // Which matches (and, for restricted scouts, which teams within) are visible.
  const assignedTeamsByMatch = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const a of mine?.match ?? []) {
      const list = map.get(a.matchNumber) ?? [];
      list.push(a.teamNumber);
      map.set(a.matchNumber, list);
    }
    return map;
  }, [mine]);

  const visibleMatches = useMemo(() => {
    let list = schedule ?? [];
    if (!canSeeAll) list = list.filter((m) => assignedTeamsByMatch.has(m.matchNumber));
    if (filterTeams.length > 0)
      list = list.filter((m) => [...m.red, ...m.blue].some((t) => filterTeams.includes(t)));
    return list;
  }, [schedule, canSeeAll, assignedTeamsByMatch, filterTeams]);

  function resetForm() {
    setAutoZone("none"); setAutoLeave(false); setAutoUndis(false); setAutoArt(0);
    setTeleZone("none"); setTeleArt(0); setEndgame("none"); setMalf([]); setNote(""); setTags([]);
  }

  async function pickTeam(n: number) {
    try {
      await claim({ workspaceId: id, matchNumber: matchNumber!, teamNumber: n });
      setTeam(n);
      resetForm();
    } catch (e) {
      toast.error(errorMessage(e, "Could not claim that robot"));
    }
  }

  /** Back out of a robot: release the claim so someone else can scout it. */
  async function releaseTeam() {
    const n = team;
    setTeam(null);
    if (n == null || matchNumber == null) return;
    try {
      await unclaim({ workspaceId: id, matchNumber, teamNumber: n });
    } catch {
      /* best-effort — the claim frees on submit anyway */
    }
  }

  async function onSubmit() {
    if (team == null || matchNumber == null) return;
    setBusy(true);
    try {
      await submit({
        workspaceId: id, matchNumber, teamNumber: team,
        autoZone, autoLeave, autoUndisrupted: autoUndis, autoArtifacts: autoArt,
        teleopZone: teleZone, teleopArtifacts: teleArt,
        endgame, malfunctions: malf, malfunctionNote: note || undefined, tags,
      });
      toast.success(`Saved Q${matchNumber} · ${team}`);
      setTeam(null);
      resetForm();
    } catch (e) {
      toast.error(errorMessage(e, "Could not submit the report"));
    } finally {
      setBusy(false);
    }
  }

  function addFilter() {
    const n = Number(filterInput.trim());
    if (Number.isInteger(n) && n > 0 && !filterTeams.includes(n)) setFilterTeams([...filterTeams, n]);
    setFilterInput("");
  }

  if (schedule === undefined || data === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (schedule.length === 0)
    return <div className={`${CARD} text-center text-sm text-muted`}>No schedule imported yet.</div>;

  const claimedBy = (n: number) => state?.claims.find((c) => c.teamNumber === n);
  const reported = (n: number) => state?.reportedTeams.includes(n);

  // For a restricted scout, only their assigned team(s) in the selected match.
  const teamsForMatch = (m: NonNullable<typeof match>): number[] => {
    const all = [...m.red, ...m.blue];
    if (canSeeAll) return all;
    const allowed = assignedTeamsByMatch.get(m.matchNumber) ?? [];
    return all.filter((t) => allowed.includes(t));
  };

  const sideOf = (m: NonNullable<typeof match>, n: number) => (m.red.includes(n) ? "red" : "blue");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[18px] font-semibold">Match scouting</h2>
        {!canSeeAll && (
          <span className="text-[12px] text-muted">{visibleMatches.length} assigned</span>
        )}
      </div>

      {/* Admin/free: filter matches by team */}
      {canSeeAll && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFilter()}
              inputMode="numeric"
              placeholder="Filter by team # (e.g. 30435)"
              className="flex-1 rounded-xl border border-[#232323] bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3a3a3a]"
            />
            <button onClick={addFilter} className="rounded-xl border border-[#232323] px-3.5 text-[13px] text-muted hover:border-[#3a3a3a] hover:text-foreground">
              Add
            </button>
          </div>
          {filterTeams.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {filterTeams.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterTeams(filterTeams.filter((x) => x !== t))}
                  className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[12px] text-accent"
                >
                  {t} ✕
                </button>
              ))}
              <button onClick={() => setFilterTeams([])} className="px-2 py-1 text-[12px] text-muted hover:text-foreground">
                clear
              </button>
            </div>
          )}
        </div>
      )}

      {!canSeeAll && visibleMatches.length === 0 ? (
        <div className={`${CARD} text-center text-sm text-muted`}>
          No matches assigned to you yet. An admin assigns matches on the Members page.
        </div>
      ) : (
        <>
          {/* Match selector */}
          <select
            value={matchNumber ?? ""}
            onChange={(e) => {
              void releaseTeam();
              setMatchNumber(e.target.value ? Number(e.target.value) : null);
            }}
            className="w-full rounded-xl border border-[#232323] bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-[#3a3a3a]"
          >
            <option value="">Select a qualification match…</option>
            {visibleMatches.map((m) => (
              <option key={m.matchNumber} value={m.matchNumber}>
                Q{m.matchNumber}
                {!canSeeAll && assignedTeamsByMatch.get(m.matchNumber)?.length
                  ? ` · your team ${assignedTeamsByMatch.get(m.matchNumber)!.join(", ")}`
                  : ""}
              </option>
            ))}
          </select>

          {/* Team picker */}
          {match && team == null && (
            <div className="grid grid-cols-2 gap-2">
              {teamsForMatch(match).map((n) => {
                const side = sideOf(match, n);
                const c = claimedBy(n);
                const done = reported(n);
                // Your own claim stays tappable — otherwise backing out of a
                // robot would lock it away from everyone, including you.
                const mineClaim = c != null && c.memberId === data?.member._id;
                const disabled = !!done || (!!c && !mineClaim);
                return (
                  <button
                    key={n}
                    disabled={disabled}
                    onClick={() => pickTeam(n)}
                    className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${disabled ? "" : "hover:bg-[#101010]"}`}
                    style={{ borderColor: side === "red" ? "rgba(255,93,108,0.4)" : "rgba(77,141,255,0.4)" }}
                  >
                    <div className="font-mono text-[15px] font-bold">{n}</div>
                    <div className="text-[11px] text-muted">
                      {done ? "reported" : mineClaim ? "resume ·  yours" : c ? `taken · ${c.by}` : "tap to scout"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Form */}
      {match && team != null && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold">
              Q{matchNumber} · Team <span className="font-mono">{team}</span>
            </div>
            <button onClick={releaseTeam} className="text-[13px] text-muted hover:text-foreground">
              change
            </button>
          </div>

          <section>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Auto zone</div>
            <Radio options={["far", "near", "none"] as const} value={autoZone} set={setAutoZone} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Toggle on={autoLeave} onClick={() => setAutoLeave(!autoLeave)}>Leave</Toggle>
              <Toggle on={autoUndis} onClick={() => setAutoUndis(!autoUndis)}>Undisrupted</Toggle>
            </div>
            <div className="mt-2"><Stepper label="Auto artifacts" value={autoArt} set={setAutoArt} onTally={() => setTally("auto")} /></div>
          </section>

          <section>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">TeleOp zone</div>
            <Radio options={["far", "near", "none"] as const} value={teleZone} set={setTeleZone} />
            <div className="mt-2"><Stepper label="TeleOp artifacts" value={teleArt} set={setTeleArt} onTally={() => setTally("teleop")} /></div>
          </section>

          <section>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Endgame</div>
            <Radio options={["park", "tilt", "climb", "none"] as const} value={endgame} set={setEndgame} />
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

      {tally && (
        <TallyOverlay
          label={tally === "auto" ? "Auto artifacts" : "TeleOp artifacts"}
          value={tally === "auto" ? autoArt : teleArt}
          inc={() => (tally === "auto" ? setAutoArt((v) => v + 1) : setTeleArt((v) => v + 1))}
          dec={() => (tally === "auto" ? setAutoArt((v) => Math.max(0, v - 1)) : setTeleArt((v) => Math.max(0, v - 1)))}
          onClose={() => setTally(null)}
        />
      )}
    </div>
  );
}

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <MatchScout id={id as Id<"workspaces">} />;
}
