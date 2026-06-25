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

type Flat = {
  kind: "team" | "event";
  href: string;
  primary: string;
  secondary: string;
};

// Session result cache (keyed by season:term) so repeat / backspaced searches are
// instant instead of re-hitting the API. Small LRU-ish cap.
const RESULT_CACHE = new Map<string, Flat[]>();
const CACHE_MAX = 80;
function cachePut(key: string, value: Flat[]) {
  RESULT_CACHE.delete(key);
  RESULT_CACHE.set(key, value);
  if (RESULT_CACHE.size > CACHE_MAX) {
    RESULT_CACHE.delete(RESULT_CACHE.keys().next().value!);
  }
}

export default function SearchBar({ size = "sm" }: { size?: "sm" | "lg" }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Flat[]>([]);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    // Instant from cache (repeat / backspaced searches) — no fetch, no spinner.
    const key = `${CURRENT_SEASON}:${term.toLowerCase()}`;
    const cached = RESULT_CACHE.get(key);
    if (cached) {
      setHits(cached);
      setActive(0);
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
        cachePut(key, flat);
        setHits(flat);
        setActive(0);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

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

  // A numeric query gets an instant "Team N" result at the top (no API wait).
  const term = q.trim();
  const numericHref = /^\d{1,6}$/.test(term) ? `/teams/${term}` : null;
  const results: Flat[] = numericHref
    ? [
        { kind: "team", href: numericHref, primary: `Team ${term}`, secondary: "Go to team →" },
        ...hits.filter((h) => h.href !== numericHref),
      ]
    : hits;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      if (results[active]) go(results[active].href);
      else if (numericHref) go(numericHref);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showDrop = open && term.length >= 2;
  const lg = size === "lg";

  return (
    <div ref={boxRef} className="relative w-full">
      <div
        className={`flex items-center gap-2.5 rounded-full border border-[#232323] bg-[#0c0c0c] transition-colors focus-within:border-accent ${
          lg ? "px-[22px] py-[14px]" : "px-4 py-[9px]"
        }`}
      >
        <svg
          width={lg ? "18" : "15"}
          height={lg ? "18" : "15"}
          viewBox="0 0 24 24"
          fill="none"
          className="shrink-0"
        >
          <circle cx="11" cy="11" r="7" stroke="#6b6f78" strokeWidth="2" />
          <path d="M20 20l-3.5-3.5" stroke="#6b6f78" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search teams or events…"
          aria-label="Search teams or events"
          className={`w-full bg-transparent text-foreground outline-none placeholder:text-[#6b6f78] ${
            lg ? "text-[16px]" : "text-[14px]"
          }`}
        />
        {loading && (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#232323] border-t-accent" />
        )}
      </div>

      {showDrop && (
        <div
          className="ts-scroll absolute left-0 right-0 z-[70] mt-2 overflow-hidden rounded-[18px] border border-[#232323] bg-[#0a0a0a] text-left shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
          style={{ maxHeight: 360, overflowY: "auto" }}
        >
          {results.length === 0 && !loading ? (
            <div className="px-4 py-3.5 text-[13px] text-[#6b6f78]">No results.</div>
          ) : (
            <ul className="py-0">
              {results.map((h, i) => (
                <li key={h.href}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h.href)}
                    className={`flex w-full items-center gap-3 border-t border-[#161616] px-4 py-[11px] text-left first:border-t-0 ${
                      i === active ? "bg-[#121212]" : ""
                    }`}
                  >
                    <span
                      className="shrink-0 rounded-md px-[7px] py-[3px] font-mono text-[9px] font-bold uppercase tracking-[0.1em]"
                      style={
                        h.kind === "team"
                          ? { background: "rgba(205,14,14,0.18)", color: "#ff7a7a" }
                          : { background: "rgba(54,214,194,0.16)", color: "#56e0cf" }
                      }
                    >
                      {h.kind}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-foreground">
                        {h.primary}
                      </span>
                      <span className="block truncate text-[11px] text-[#6b6f78]">
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
