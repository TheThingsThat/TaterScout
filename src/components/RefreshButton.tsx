"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RefreshResult {
  changed: boolean;
  newEvents: number;
  updatedEvents: number;
  newMatches: number;
  error?: string;
}

export default function RefreshButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function refresh() {
    if (loading) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const j: RefreshResult = await res.json();
      if (!res.ok || j.error) {
        setMsg(j.error ?? "Refresh failed");
      } else if (!j.changed) {
        setMsg("Up to date");
      } else {
        const parts: string[] = [];
        if (j.newMatches) parts.push(`${j.newMatches} match${j.newMatches === 1 ? "" : "es"}`);
        if (j.newEvents) parts.push(`${j.newEvents} new event${j.newEvents === 1 ? "" : "s"}`);
        setMsg(`Added ${parts.join(", ") || "updates"}`);
        router.refresh(); // re-render server components with the recomputed data
      }
    } catch {
      setMsg("Refresh failed");
    } finally {
      setLoading(false);
      window.setTimeout(() => setMsg(null), 4500);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        onClick={refresh}
        disabled={loading}
        title="Fetch new data from FTCScout and recompute"
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
