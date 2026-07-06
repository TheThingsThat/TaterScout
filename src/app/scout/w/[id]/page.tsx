"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const CARD = "rounded-2xl border border-[#1a1a1a] bg-surface p-5";

function Overview({ id }: { id: Id<"workspaces"> }) {
  const data = useQuery(api.workspaces.get, { workspaceId: id });
  const teams = useQuery(api.teams.list, { workspaceId: id });
  const schedule = useQuery(api.match.schedule, { workspaceId: id });

  if (data === undefined) return <div className="text-sm text-muted">Loading…</div>;
  if (data === null)
    return (
      <div className={`${CARD} text-center text-sm text-muted`}>
        No access. <Link href="/scout" className="text-accent no-underline">Back</Link>
      </div>
    );

  const { workspace, member } = data;
  const teamCount = teams?.length ?? 0;
  const matchCount = schedule?.length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-0.01em]">{workspace.name}</h1>
        <p className="mt-1 text-[14px] text-muted">
          {workspace.eventName ?? workspace.eventCode} · you are{" "}
          <span className="text-foreground">{member.name}</span> ({member.role})
        </p>
        {member.role === "admin" && (
          <p className="mt-1 text-[13px] text-muted">
            Join code{" "}
            <span className="font-mono font-semibold tracking-[0.14em] text-foreground">
              {workspace.joinCode}
            </span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className={CARD}>
          <div className="text-[28px] font-bold tabular-nums">{teamCount}</div>
          <div className="text-[12px] text-muted">teams</div>
        </div>
        <div className={CARD}>
          <div className="text-[28px] font-bold tabular-nums">{matchCount}</div>
          <div className="text-[12px] text-muted">qual matches</div>
        </div>
      </div>

      {teamCount === 0 && (
        <div className={`${CARD} text-[14px] text-muted`}>
          {member.role === "admin" ? (
            <>
              No event imported yet.{" "}
              <Link href={`/scout/w/${id}/setup`} className="text-accent no-underline">
                Go to Setup →
              </Link>
            </>
          ) : (
            "Waiting for an admin to import the event."
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Overview id={id as Id<"workspaces">} />;
}
