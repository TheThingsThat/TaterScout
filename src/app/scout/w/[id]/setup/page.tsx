"use client";

import { use, useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { formatDate, locationStr } from "@/lib/format";

const CARD = "rounded-2xl border border-[#1a1a1a] bg-surface p-5";
const INPUT =
  "w-full rounded-xl border border-[#232323] bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-[#3a3a3a]";

interface EventResult {
  code: string;
  season: number;
  name: string;
  start: string;
  type: string;
  location: { city: string | null; state: string | null; country: string | null };
}

function Setup({ id }: { id: Id<"workspaces"> }) {
  const data = useQuery(api.workspaces.get, { workspaceId: id });
  const teams = useQuery(api.teams.list, { workspaceId: id });
  const setEvent = useMutation(api.workspaces.setEvent);
  const setMyTeam = useMutation(api.workspaces.setMyTeam);
  const importSnapshot = useMutation(api.events.importSnapshot);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EventResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [importingCode, setImportingCode] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  // Drop a pending debounce/request if the page unmounts mid-search.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      abort.current?.abort();
    };
  }, []);

  if (data === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (data === null || data.member.role !== "admin")
    return <div className={`${CARD} text-sm text-muted`}>Admins only.</div>;

  const { workspace } = data;
  const season = workspace.season;
  const count = teams?.length ?? 0;
  const hasEvent = !!workspace.eventCode;
  const myTeam = workspace.myTeam ?? null;
  const teamMatches = teamQuery.trim()
    ? (teams ?? [])
        .filter((t) =>
          `${t.teamNumber} ${t.name}`.toLowerCase().includes(teamQuery.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];

  function onQuery(v: string) {
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    const q = v.trim();
    timer.current = window.setTimeout(async () => {
      if (q.length < 2) {
        abort.current?.abort();
        setResults([]);
        setSearching(false);
        return;
      }
      // Cancel the previous request so a slow earlier response can't land after
      // (and overwrite) a newer one.
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setSearching(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&season=${season}`,
          { signal: ctrl.signal },
        );
        const j = await res.json();
        setResults((j.events ?? []) as EventResult[]);
      } catch {
        if (!ctrl.signal.aborted) setResults([]);
      } finally {
        if (abort.current === ctrl) setSearching(false);
      }
    }, 250);
  }

  async function importCode(code: string, name?: string) {
    setImportingCode(code);
    try {
      const res = await fetch(`/api/scout/import?season=${season}&code=${encodeURIComponent(code)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Import failed");
      // Set the event first (it carries the venue timezone we just fetched), so
      // a re-import of the same code refreshes tz without wiping data.
      if (name !== undefined) {
        await setEvent({ workspaceId: id, eventCode: code, eventName: name, timezone: j.timezone });
      }
      const r = await importSnapshot({ workspaceId: id, teams: j.teams, matches: j.matches });
      toast.success(`Imported ${name ?? code}: ${r.teams} teams, ${r.matches} matches`);
      setQuery("");
      setResults([]);
      setChanging(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImportingCode(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[18px] font-semibold">Event setup</h2>
        <p className="mt-1 text-[14px] text-muted">
          Search for your event and import it — teams, rank, EPA/OPR, and the qual schedule with
          TaterScout&apos;s predicted times.
        </p>
      </div>

      {hasEvent && !changing ? (
        <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
          <div className="text-[14px] text-muted">
            <span className="font-semibold text-foreground">{workspace.eventName || workspace.eventCode}</span>{" "}
            · {count} teams imported
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => importCode(workspace.eventCode)}
              disabled={importingCode != null}
              className="rounded-xl border border-[#232323] px-3.5 py-2 text-[13px] text-muted hover:border-[#3a3a3a] hover:text-foreground disabled:opacity-60"
            >
              {importingCode ? "Importing…" : "Re-import"}
            </button>
            <button
              onClick={() => setChanging(true)}
              className="rounded-xl border border-[#232323] px-3.5 py-2 text-[13px] text-muted hover:border-[#3a3a3a] hover:text-foreground"
            >
              Change event
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search events by name or code…"
            className={INPUT}
          />
          {changing && (
            <button onClick={() => setChanging(false)} className="text-[13px] text-muted hover:text-foreground">
              ← keep {workspace.eventName || workspace.eventCode}
            </button>
          )}
          <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface">
            {searching ? (
              <div className="px-4 py-6 text-center text-sm text-muted">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">
                {query.trim().length < 2 ? "Type an event name or code." : "No matching events."}
              </div>
            ) : (
              results.map((ev) => (
                <button
                  key={ev.code}
                  onClick={() => importCode(ev.code, ev.name)}
                  disabled={importingCode != null}
                  className="flex w-full items-center justify-between gap-3 border-t border-[#141414] px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-[#101010] disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[#e7eaf0]">{ev.name}</div>
                    <div className="truncate text-[12px] text-[#6b6f78]">
                      {ev.code}
                      {locationStr(ev.location) ? ` · ${locationStr(ev.location)}` : ""}
                      {ev.start ? ` · ${formatDate(ev.start)}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-[12px] text-accent">
                    {importingCode === ev.code ? "importing…" : "Import →"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {hasEvent && count > 0 && (
        <div className={CARD}>
          <h3 className="text-[15px] font-semibold">Your team</h3>
          <p className="mt-1 text-[13px] text-muted">
            Which team are you scouting for? Drives the &quot;Up next&quot; card on the overview.
          </p>
          {myTeam != null ? (
            <div className="mt-3 flex items-center gap-3">
              <span className="rounded-lg bg-accent/15 px-2.5 py-1 font-mono text-[14px] font-bold text-accent">
                {myTeam}
              </span>
              <span className="text-[14px] text-muted">
                {(teams ?? []).find((t) => t.teamNumber === myTeam)?.name ?? ""}
              </span>
              <button
                onClick={() => setMyTeam({ workspaceId: id, teamNumber: null })}
                className="ml-auto text-[13px] text-muted hover:text-foreground"
              >
                Clear
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <input
                value={teamQuery}
                onChange={(e) => setTeamQuery(e.target.value)}
                placeholder="Search your team by number or name…"
                className={INPUT}
              />
              {teamMatches.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-[#1f1f1f]">
                  {teamMatches.map((t) => (
                    <button
                      key={t.teamNumber}
                      onClick={async () => {
                        await setMyTeam({ workspaceId: id, teamNumber: t.teamNumber });
                        setTeamQuery("");
                        toast.success(`You're scouting for ${t.teamNumber}`);
                      }}
                      className="flex w-full items-center gap-2 border-t border-[#141414] px-3.5 py-2.5 text-left first:border-t-0 hover:bg-[#101010]"
                    >
                      <span className="font-mono text-[13px] text-muted">{t.teamNumber}</span>
                      <span className="truncate text-[14px] text-foreground">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Setup id={id as Id<"workspaces">} />;
}
