"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { RegionResponse } from "@/app/api/region/route";
import TeamTable, { hasEnded, useNow } from "./TeamTable";
import { useMe } from "./useMe";

const HEADING = "font-mono text-[11px] uppercase tracking-[0.16em] text-[#6b6f78]";
const SELECT =
  "cursor-pointer rounded-full border border-[#232323] bg-[#0c0c0c] py-[7px] pl-3.5 pr-8 text-[13px] text-foreground outline-none focus:border-accent";

/** Star a region (or clear it with null), updating the shared `mine` query at once. */
export function useSetRegion() {
  const set = useMutation(api.stars.setRegion).withOptimisticUpdate((store, { region }) => {
    const cur = store.getQuery(api.stars.mine, {});
    if (cur) store.setQuery(api.stars.mine, {}, { ...cur, region });
  });
  return async (region: string | null) => {
    try {
      await set({ region });
    } catch (e) {
      alert(e instanceof ConvexError ? String(e.data) : "Couldn't save that. Please try again.");
    }
  };
}

function RegionSelect({ regions, value, onPick }: { regions: string[]; value: string; onPick: (r: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        aria-label="Starred region"
        className={SELECT}
      >
        {!value && <option value="">Choose a region…</option>}
        {regions.map((r) => (
          <option key={r} value={r} style={{ background: "#0c0c0c" }}>
            {r}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-[#6b6f78]">▼</span>
    </div>
  );
}

/** The homepage's starred-region panel: the region's top 10 teams by EPA, shown
 *  like starred teams. Signed-in (non-demo) visitors only. */
export default function StarredRegion({ regions }: { regions: string[] }) {
  const me = useMe();
  const hasToken = useAuthToken() !== null;
  const setRegion = useSetRegion();
  const now = useNow();
  const [data, setData] = useState<RegionResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const region = me?.region ?? null;
  const shown = data && data.region === region ? data : null;
  // Refetch when the region changes, or once a shown team's event has ended.
  const ended = (shown?.teams ?? []).filter((t) => hasEnded(t, now)).map((t) => t.number).join(",");

  useEffect(() => {
    if (!region) return;
    let cancelled = false;
    // After an event ends the URL is unchanged, so skip the HTTP cache (max-age=60)
    // or it hands back the same ended row.
    fetch(`/api/region?region=${encodeURIComponent(region)}`, ended ? { cache: "no-store" } : undefined)
      .then((r) => (r.ok ? (r.json() as Promise<RegionResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setFailed(res.failed.length > 0);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [region, ended, attempt]);

  // A signed-in visitor still loading: hold the section's space so it doesn't
  // pop in above starred teams and push the page down.
  if (me === undefined && hasToken)
    return (
      <section className="mx-auto max-w-[1240px] px-5 pt-12 sm:px-8">
        <h2 className={`mb-4 ${HEADING}`}>Starred region</h2>
        <div className="h-[72px] animate-pulse rounded-[20px] border border-[#1a1a1a] bg-surface" />
      </section>
    );
  if (!me || me.isDemo) return null;

  if (!region) {
    return (
      <section className="mx-auto max-w-[1240px] px-5 pt-12 sm:px-8">
        <h2 className={`mb-4 ${HEADING}`}>Starred region</h2>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-[#1a1a1a] bg-surface px-5 py-5">
          <p className="text-[14px] text-muted">Star a region to follow its top 10 teams here.</p>
          <RegionSelect regions={regions} value="" onPick={(r) => void setRegion(r)} />
        </div>
      </section>
    );
  }

  const retry = (
    <button onClick={() => setAttempt((a) => a + 1)} className="text-accent hover:underline">
      Retry
    </button>
  );
  const missing = shown ? shown.failed.length : 0;

  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-12 sm:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className={HEADING}>
          Starred region · {region}
          {shown ? ` · top ${shown.teams.length + missing} of ${shown.regionTeamCount.toLocaleString()}` : ""}
        </h2>
        <div className="flex items-center gap-2">
          <RegionSelect regions={regions.includes(region) ? regions : [region, ...regions]} value={region} onPick={(r) => void setRegion(r)} />
          <button
            onClick={() => void setRegion(null)}
            className="rounded-full border border-[#232323] px-3 py-[7px] text-[13px] text-muted transition-colors hover:border-[#3a3a3a] hover:text-foreground"
          >
            Unstar
          </button>
        </div>
      </div>
      {shown && shown.teams.length > 0 ? (
        <TeamTable
          rows={shown.teams}
          now={now}
          season={shown.season}
          teamCount={shown.teamCount}
          footer={missing > 0 && (failed ? <>Couldn&apos;t load {missing === 1 ? "a team" : `${missing} teams`}. {retry}</> : null)}
        />
      ) : (
        <div className="rounded-[20px] border border-[#1a1a1a] bg-surface px-5 py-6 text-[13px] text-[#6b6f78]">
          {failed ? (
            <>Couldn&apos;t load {region}. {retry}</>
          ) : shown ? (
            `No rated teams in ${region} yet this season.`
          ) : (
            "Loading…"
          )}
        </div>
      )}
    </section>
  );
}
