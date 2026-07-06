"use client";

import { use, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";

const CARD = "rounded-2xl border border-[#1a1a1a] bg-surface p-5";

function Setup({ id }: { id: Id<"workspaces"> }) {
  const data = useQuery(api.workspaces.get, { workspaceId: id });
  const teams = useQuery(api.teams.list, { workspaceId: id });
  const importSnapshot = useMutation(api.events.importSnapshot);
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (data === null || data.member.role !== "admin")
    return <div className={`${CARD} text-sm text-muted`}>Admins only.</div>;

  const { workspace } = data;
  const count = teams?.length ?? 0;

  async function runImport() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/scout/import?season=${workspace.season}&code=${encodeURIComponent(workspace.eventCode)}`,
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Import failed");
      const r = await importSnapshot({ workspaceId: id, teams: j.teams, matches: j.matches });
      toast.success(`Imported ${r.teams} teams and ${r.matches} qual matches`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[18px] font-semibold">Event setup</h2>
        <p className="mt-1 text-[14px] text-muted">
          Import <span className="font-mono text-foreground">{workspace.eventCode}</span> from the
          FIRST API — teams, rank, EPA/OPR, and the qualification schedule with TaterScout&apos;s
          predicted start times.
        </p>
      </div>

      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[14px] text-muted">
            {count > 0 ? (
              <>
                <span className="font-semibold text-foreground">{count}</span> teams currently
                imported. Re-importing refreshes stats + schedule (match reports are kept).
              </>
            ) : (
              "Nothing imported yet."
            )}
          </div>
          <button
            onClick={runImport}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2.5 text-[15px] font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Importing…" : count > 0 ? "Re-import" : "Import event"}
          </button>
        </div>
      </div>

      <p className="text-[12px] text-[#6b6f78]">
        Note: predicted times only appear once FIRST publishes the schedule for the event.
      </p>
    </div>
  );
}

export default function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Setup id={id as Id<"workspaces">} />;
}
