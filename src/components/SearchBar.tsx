"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CURRENT_SEASON } from "@/lib/season";
import { locationStr } from "@/lib/format";

interface TeamHit {
  number: number;
  name: string;
  location: { city?: string | null; state?: string | null; country?: string | null };
}
interface EventHit {
  code: string;
  season: number;
  name: string;
  type: string;
  location: { city?: string | null; state?: string | null; country?: string | null };
}

type Flat =
  | { kind: "team"; href: string; primary: string; secondary: string }
  | { kind: "event"; href: string; primary: string; secondary: string };

export default function SearchBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Flat[]>([]);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(term)}&season=${CURRENT_SEASON}`,
          { signal: ctrl.signal },
        );
        const data: { teams: TeamHit[]; events: EventHit[] } = await res.json();
        const flat: Flat[] = [
          ...data.teams.map((t) => ({
            kind: "team" as const,
            href: `/teams/${t.number}`,
            primary: `${t.number} · ${t.name}`,
            secondary: locationStr(t.location),
          })),
          ...data.events.map((e) => ({
            kind: "event" as const,
            href: `/events/${e.season}/${e.code}`,
            primary: e.name,
            secondary: locationStr(e.location),
          })),
        ];
        setHits(flat);
        setActive(0);
      } catch {
        /* aborted or failed — ignore */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      if (hits[active]) {
        go(hits[active].href);
      } else if (/^\d{1,6}$/.test(q.trim())) {
        go(`/teams/${q.trim()}`);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showDrop = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 focus-within:border-accent transition-colors">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-muted shrink-0">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search teams or events…"
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted outline-none"
          aria-label="Search teams or events"
        />
        {loading && (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent" />
        )}
      </div>

      {showDrop && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          {hits.length === 0 && !loading ? (
            <div className="px-4 py-3 text-sm text-muted">
              No results for “{q.trim()}”.
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto scroll-thin py-1">
              {hits.map((h, i) => (
                <li key={h.href}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h.href)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                      i === active ? "bg-surface-2" : ""
                    }`}
                  >
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        h.kind === "team"
                          ? "bg-accent/15 text-accent"
                          : "bg-accent-2/15 text-accent-2"
                      }`}
                    >
                      {h.kind}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {h.primary}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {h.secondary}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
