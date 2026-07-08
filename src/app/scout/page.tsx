"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, Authenticated, AuthLoading } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CURRENT_SEASON } from "@/lib/season";

const INPUT =
  "w-full rounded-xl border border-[#232323] bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-[#3a3a3a]";
const CARD = "rounded-2xl border border-[#1a1a1a] bg-surface p-5";

function Dashboard() {
  const router = useRouter();
  const workspaces = useQuery(api.workspaces.mine);
  const create = useMutation(api.workspaces.create);
  const join = useMutation(api.workspaces.join);

  const [cName, setCName] = useState("");
  const [cWho, setCWho] = useState("");
  const [jCode, setJCode] = useState("");
  const [jWho, setJWho] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    if (!cName.trim() || !cWho.trim()) return;
    setBusy(true);
    try {
      const { workspaceId } = await create({
        name: cName.trim(),
        season: CURRENT_SEASON,
        displayName: cWho.trim(),
      });
      toast.success("Workspace created");
      router.push(`/scout/w/${workspaceId}`);
    } catch (e) {
      toast.error((e as Error).message ?? "Could not create workspace");
    } finally {
      setBusy(false);
    }
  }

  async function onJoin() {
    if (!jCode.trim() || !jWho.trim()) return;
    setBusy(true);
    try {
      const { workspaceId } = await join({ joinCode: jCode.trim(), displayName: jWho.trim() });
      toast.success("Joined workspace");
      router.push(`/scout/w/${workspaceId}`);
    } catch (e) {
      toast.error((e as Error).message ?? "Could not join");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-0.01em]">Scouting</h1>
        <p className="mt-1 text-[14px] text-muted">
          Your event workspaces. Create one as admin, or join your team&apos;s with a code.
        </p>
      </div>

      {/* My workspaces */}
      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Workspaces
        </h2>
        {workspaces === undefined ? (
          <div className={`${CARD} text-center text-sm text-muted`}>Loading…</div>
        ) : workspaces.length === 0 ? (
          <div className={`${CARD} text-center text-sm text-muted`}>
            No workspaces yet — create or join one below.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {workspaces.map((w) => (
              <Link key={w._id} href={`/scout/w/${w._id}`} className={`${CARD} block no-underline`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-[#e7eaf0]">{w.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                      w.role === "admin" ? "bg-accent/15 text-accent" : "bg-[#161616] text-muted"
                    }`}
                  >
                    {w.role}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-[#6b6f78]">
                  {w.eventName || w.eventCode || "No event yet"} · {w.season}–{(w.season + 1) % 100}
                </div>
                {w.role === "admin" && (
                  <div className="mt-3 text-[12px] text-muted">
                    Join code{" "}
                    <span className="font-mono font-semibold tracking-[0.14em] text-foreground">
                      {w.joinCode}
                    </span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Create + Join */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className={CARD}>
          <h2 className="mb-3 text-[15px] font-semibold">Create a workspace</h2>
          <div className="space-y-2.5">
            <input className={INPUT} placeholder="Workspace name (e.g. Scott Division scouting)" value={cName} onChange={(e) => setCName(e.target.value)} />
            <input className={INPUT} placeholder="Your name" value={cWho} onChange={(e) => setCWho(e.target.value)} />
            <button onClick={onCreate} disabled={busy} className="w-full rounded-xl bg-accent px-4 py-2.5 text-[15px] font-medium text-white hover:opacity-90 disabled:opacity-60">
              Create
            </button>
          </div>
        </section>

        <section className={CARD}>
          <h2 className="mb-3 text-[15px] font-semibold">Join a workspace</h2>
          <div className="space-y-2.5">
            <input className={`${INPUT} font-mono uppercase tracking-[0.14em]`} placeholder="Join code" value={jCode} onChange={(e) => setJCode(e.target.value)} />
            <input className={INPUT} placeholder="Your name" value={jWho} onChange={(e) => setJWho(e.target.value)} />
            <button onClick={onJoin} disabled={busy} className="w-full rounded-xl border border-[#232323] px-4 py-2.5 text-[15px] font-medium text-foreground hover:border-[#3a3a3a] disabled:opacity-60">
              Join
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function ScoutHome() {
  return (
    <>
      <AuthLoading>
        <div className="pt-10 text-center text-sm text-muted">Loading…</div>
      </AuthLoading>
      <Authenticated>
        <Dashboard />
      </Authenticated>
    </>
  );
}
