"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamSummary, TeamSummaryResponse } from "@/lib/teamSummary";
import SearchBar from "./SearchBar";
import TeamTable, { hasEnded, isLive, useNow } from "./TeamTable";
import { signInHref, useEndDemo, useMe } from "./useMe";

const HEADING = "font-mono text-[11px] uppercase tracking-[0.16em] text-[#6b6f78]";
function Shell({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-12 sm:px-8">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h1 className={HEADING}>
          Starred teams{count ? ` · ${count}` : ""}
        </h1>
      </div>
      {children}
    </section>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border border-[#1a1a1a] bg-surface px-6 py-10 text-center sm:px-10">
      <div className="text-[20px] font-semibold text-[#f7f8fa]">{title}</div>
      <p className="mx-auto mt-2 max-w-[460px] text-[14px] leading-[1.55] text-muted">{body}</p>
      {action}
      <div className="mx-auto mt-6 max-w-[460px] text-left">
        <SearchBar size="lg" />
      </div>
    </div>
  );
}

/** The homepage's main view: the visitor's starred teams with their next event,
 *  a countdown to it, and EPA / OPR with world ranks. */
export default function StarredTeams() {
  const me = useMe();
  const router = useRouter();
  const endDemo = useEndDemo();
  const now = useNow();
  const [data, setData] = useState<Map<number, TeamSummary>>(() => new Map());
  const [meta, setMeta] = useState<{ season: number; teamCount: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const teams = useMemo(() => me?.teams ?? [], [me]);
  // Fetch only teams we don't have yet (unstarring needs no request at all), or whose
  // shown event has since ended, so they move on to their next one.
  const missing = teams.filter((t) => {
    const d = data.get(t);
    return !d || hasEnded(d, now);
  });
  const missingKey = missing.join(",");

  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    fetch(`/api/starred?teams=${missingKey}`)
      .then((r) => (r.ok ? (r.json() as Promise<TeamSummaryResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((res) => {
        if (cancelled) return;
        setMeta({ season: res.season, teamCount: res.teamCount });
        setData((prev) => {
          const next = new Map(prev);
          for (const t of res.teams) next.set(t.number, t);
          return next;
        });
        // Failed teams stay missing: the next run retries them, or offers Retry.
        setFailed(res.failed.length > 0);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [missingKey, attempt]);

  if (me === undefined) {
    return (
      <Shell>
        <div className="h-[180px] animate-pulse rounded-[20px] border border-[#1a1a1a] bg-surface" />
      </Shell>
    );
  }

  if (me === null || me.isDemo) {
    return (
      <Shell>
        <Empty
          title="Follow your teams"
          body={
            me?.isDemo
              ? "Create an account to star teams. You'll see each one's next event, a countdown to it, and its EPA and OPR right here."
              : "Sign in and star any team to see its next event, a countdown to it, and its EPA and OPR right here."
          }
          action={
            <button
              onClick={async () => {
                // A demo session counts as signed in, so end it before signing up.
                if (me?.isDemo && !(await endDemo())) return;
                router.push(signInHref());
              }}
              className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
            >
              {me?.isDemo ? "Create an account" : "Sign in"}
            </button>
          }
        />
      </Shell>
    );
  }

  if (teams.length === 0) {
    return (
      <Shell>
        <Empty
          title="No starred teams yet"
          body="Open any team's page and press Star. It'll show up here with its next event and stats."
        />
      </Shell>
    );
  }

  const rows = teams
    .map((n) => data.get(n))
    .filter((t): t is TeamSummary => !!t)
    // At an event now first, then the soonest next event; teams with none last.
    .sort((a, b) => {
      const ka = a.next ? (isLive(a.next, now) ? -Infinity : (a.next.startMs ?? Infinity)) : Infinity;
      const kb = b.next ? (isLive(b.next, now) ? -Infinity : (b.next.startMs ?? Infinity)) : Infinity;
      return ka - kb || a.number - b.number;
    });
  const pending = teams.length - rows.length;

  return (
    <Shell count={teams.length}>
      <TeamTable
        rows={rows}
        now={now}
        season={meta?.season ?? null}
        teamCount={meta?.teamCount ?? null}
        footer={
          pending > 0 &&
          (failed ? (
            <>
              Couldn&apos;t load {pending === 1 ? "a team" : `${pending} teams`}.{" "}
              <button onClick={() => setAttempt((a) => a + 1)} className="text-accent hover:underline">
                Retry
              </button>
            </>
          ) : (
            `Loading ${pending === 1 ? "1 team" : `${pending} teams`}…`
          ))
        }
      />
      <p className="mt-2.5 text-[12px] text-[#6b6f78]">
        World rank is by EPA. Countdowns run to the start of each event&apos;s first day at the venue.
      </p>
    </Shell>
  );
}
