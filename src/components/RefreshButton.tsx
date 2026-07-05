"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface RefreshResult {
  changed: boolean;
  newEvents: number;
  updatedEvents: number;
  newMatches: number;
  error?: string;
}

/** "just now" (<5s) / "23s ago" / "5m ago" / "3h ago" / "2d ago" from the client
 *  time the last sync completed. */
function agoLabel(syncedAt: number | null): string | null {
  if (syncedAt == null) return null;
  const s = Math.max(0, Math.floor((Date.now() - syncedAt) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function RefreshButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null); // null = bar hidden
  // Client time the last sync completed (from the status poll or a manual press).
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0); // re-render so "Xs ago" ticks up
  const trickle = useRef<number | null>(null);
  const router = useRouter();

  useEffect(() => () => { if (trickle.current) clearInterval(trickle.current); }, []);

  // Tick every second so the seconds counter stays live.
  useEffect(() => {
    const id = window.setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll the freshness probe so background (cron) syncs show up without a reload.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/status", { cache: "no-store" });
        const j = (await r.json()) as { secondsAgo: number | null };
        if (alive && typeof j.secondsAgo === "number") {
          setSyncedAt(Date.now() - j.secondsAgo * 1000);
        }
      } catch {
        /* ignore — next poll retries */
      }
    };
    poll();
    const id = window.setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  function startBar() {
    setPct(8);
    if (trickle.current) clearInterval(trickle.current);
    // Ease toward 90% while the request is in flight, then snap to 100% on done.
    trickle.current = window.setInterval(() => {
      setPct((p) => (p == null ? p : Math.min(90, p + (90 - p) * 0.12)));
    }, 180);
  }
  function finishBar() {
    if (trickle.current) clearInterval(trickle.current);
    trickle.current = null;
    setPct(100);
    window.setTimeout(() => setPct(null), 400); // fills + fades, then removes
  }

  async function refresh() {
    if (loading) return;
    setLoading(true);
    setMsg(null);
    startBar();
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const j: RefreshResult = await res.json();
      if (!res.ok || j.error) {
        setMsg(j.error ?? "Refresh failed");
      } else {
        if (!j.changed) {
          setMsg("Up to date");
        } else {
          const parts: string[] = [];
          if (j.newMatches) parts.push(`${j.newMatches} match${j.newMatches === 1 ? "" : "es"}`);
          if (j.newEvents) parts.push(`${j.newEvents} new event${j.newEvents === 1 ? "" : "s"}`);
          setMsg(`Added ${parts.join(", ") || "updates"}`);
          router.refresh(); // pull the changed data into the page
        }
        // A sync just completed (changed or not) → stamp resets to "just now".
        setSyncedAt(Date.now());
      }
    } catch {
      setMsg("Refresh failed");
    } finally {
      setLoading(false);
      finishBar();
      window.setTimeout(() => setMsg(null), 4500);
    }
  }

  const updatedLabel = agoLabel(syncedAt);

  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* Top-of-viewport progress bar while refreshing */}
      {pct !== null && (
        <div
          className="pointer-events-none fixed left-0 top-0 z-[100] h-[3px] rounded-r-full bg-accent shadow-[0_0_10px_var(--accent)]"
          style={{
            width: `${pct}%`,
            opacity: pct >= 100 ? 0 : 1,
            transition: "width 0.2s ease-out, opacity 0.35s ease-out",
          }}
        />
      )}
      {/* Freshness stamp — yields to the transient action message during a refresh */}
      {!msg && updatedLabel && (
        <span
          className="hidden whitespace-nowrap text-[12px] text-[#6b6f78] sm:inline"
          title="Time since the last data sync"
        >
          Updated {updatedLabel}
        </span>
      )}
      <button
        onClick={refresh}
        disabled={loading}
        title="Fetch new data from the FIRST API and recompute"
        aria-label="Refresh data"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#232323] text-[#9aa0aa] transition-colors hover:border-[#3a3a3a] hover:text-foreground disabled:opacity-60"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={loading ? "animate-spin" : ""}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </button>
      {msg && (
        <span className="hidden whitespace-nowrap text-[12px] text-[#9aa0aa] sm:inline">{msg}</span>
      )}
    </div>
  );
}
