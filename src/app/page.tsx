import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import { getSeasonSnapshot, getWorldRecord } from "@/lib/ftc/queries";
import { CURRENT_SEASON, seasonName, seasonLabel } from "@/lib/season";
import { formatDate } from "@/lib/format";

export const revalidate = 3600;

const SEASON_TITLE = `${seasonName(CURRENT_SEASON)} · ${seasonLabel(CURRENT_SEASON)}`;

const FEATURES = [
  {
    title: "Team profiles",
    body: "EPA and OPR with auto/TeleOp splits, world rankings, and an interactive per-match EPA & OPR trajectory chart.",
    tag: "Live",
    rects: [[4, 0], [0, 4], [4, 4], [8, 4], [4, 8]],
  },
  {
    title: "Event dashboards",
    body: "Time-aware rankings as of each event, the full schedule with predicted match times, and red/blue results.",
    tag: "Live",
    rects: [[0, 0], [4, 0], [8, 0], [2, 4], [6, 4], [0, 8], [4, 8], [8, 8]],
  },
  {
    title: "Predictions",
    body: "Monte-Carlo win probabilities, predicted seeds and make-playoffs odds, plus a per-match win % for unplayed matches.",
    tag: "Live",
    rects: [[0, 6], [3, 3], [6, 0], [3, 8], [8, 5]],
  },
  {
    title: "Strength of schedule",
    body: "How lucky was a team's draw? Δ RP, Δ Rank and Δ EPA percentiles versus thousands of random schedules.",
    tag: "Live",
    rects: [[0, 0], [0, 4], [0, 8], [8, 0], [8, 4], [8, 8]],
  },
];

async function StatStrip() {
  let snap: { activeTeamsCount: number; matchesPlayedCount: number } | null = null;
  try {
    snap = await getSeasonSnapshot(CURRENT_SEASON);
  } catch {
    snap = null;
  }
  const items: [string, string][] = [
    [SEASON_TITLE, "season"],
    [snap ? snap.activeTeamsCount.toLocaleString() : "—", "active teams"],
    [snap ? snap.matchesPlayedCount.toLocaleString() : "—", "matches played"],
  ];
  return (
    <section className="mx-auto mt-16 max-w-[1240px] border-y border-[#161616] px-8 py-[26px]">
      <div className="flex flex-wrap gap-x-9 gap-y-2 text-[clamp(18px,2vw,23px)] leading-[1.5]">
        {items.map(([v, l]) => (
          <span key={l}>
            <span className="font-semibold text-[#f7f8fa]">{v}</span>{" "}
            <span className="text-[#6b6f78]">{l}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

async function WorldRecord() {
  let wr = null;
  try {
    wr = await getWorldRecord(CURRENT_SEASON);
  } catch {
    wr = null;
  }
  if (!wr) return null;
  return (
    <section className="mx-auto mt-16 max-w-[1240px] px-8">
      <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-[#6b6f78]">
        World Record
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[22px] border border-[#2a241a] bg-[#1c1814] md:grid-cols-[1.3fr_1fr]">
        <div className="bg-[#0a0805] px-[34px] pb-[30px] pt-[34px]">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-gold">
            <span>✦</span> Highest match score · {SEASON_TITLE}
          </div>
          <div className="mt-3.5 flex items-baseline gap-3">
            <span className="font-display text-[clamp(54px,7vw,86px)] font-semibold leading-none tabular-nums text-gold">
              {wr.score}
            </span>
            <span className="text-[12px] text-[#8a7a52]">points (no-penalty)</span>
          </div>
          <div className="mt-[18px] text-[16px] text-[#cfd3da]">
            {wr.teams.map((t, i) => (
              <span key={t.number}>
                {i > 0 && <span className="text-[#5a513a]"> &amp; </span>}
                <Link
                  href={`/teams/${t.number}?season=${CURRENT_SEASON}`}
                  className="text-inherit no-underline hover:text-gold"
                >
                  <span className="font-mono text-[13px] text-[#8a7a52]">{t.number}</span>{" "}
                  {t.name}
                </Link>
              </span>
            ))}
          </div>
        </div>
        <Link
          href={`/events/${wr.season}/${wr.eventCode}`}
          className="relative flex flex-col justify-end overflow-hidden bg-gold p-7 no-underline"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(0,0,0,0.32) 1.2px, transparent 1.7px)",
              backgroundSize: "8px 8px",
            }}
          />
          <div className="relative font-mono text-[14px] uppercase tracking-[0.12em] text-[#5a4410]">
            Event
          </div>
          <div className="relative mt-1.5 font-display text-[22px] font-bold leading-[1.15] text-[#1a1305]">
            {wr.eventName}
          </div>
          <div className="relative mt-2 flex items-center gap-1.5 text-[12px] text-[#5a4410]">
            {formatDate(wr.eventStart)} <span>→</span>
          </div>
        </Link>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative mx-auto max-w-[1240px] overflow-hidden px-8 pb-7 pt-24 text-center">
        <div
          className="hero-dots pointer-events-none absolute inset-0 z-0 opacity-[0.55]"
          style={{
            WebkitMaskImage:
              "radial-gradient(560px 360px at 50% 6%, #000 0%, transparent 72%)",
            maskImage:
              "radial-gradient(560px 360px at 50% 6%, #000 0%, transparent 72%)",
          }}
        />
        <div className="relative z-[1]">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#232323] bg-[#0a0a0a] px-4 py-[7px] font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal" />
            Powered by the FTCScout API
          </span>
          <h1 className="font-display mx-auto mt-[30px] max-w-[900px] text-balance text-[clamp(42px,6.2vw,80px)] font-medium leading-[1.04] tracking-[-0.01em] text-[#f7f8fa]">
            All your FTC scouting,
            <br />
            <span className="italic text-accent">one dashboard.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[560px] text-balance text-[18px] leading-[1.55] text-muted">
            Search any FIRST Tech Challenge team or event for EPA, OPR, win
            predictions, strength of schedule, and rankings.
          </p>
          <div className="mx-auto mt-[34px] max-w-[520px]">
            <SearchBar size="lg" />
          </div>
          <p className="mt-[18px] text-[13px] text-[#6b6f78]">
            Try{" "}
            <Link href="/teams/641" className="text-accent no-underline hover:underline">
              team 641
            </Link>
            , search an event, or browse the{" "}
            <Link href="/rankings" className="text-accent no-underline hover:underline">
              full rankings
            </Link>
            .
          </p>
        </div>
      </section>

      <StatStrip />
      <WorldRecord />

      {/* What's inside — light section */}
      <section className="mt-[88px] bg-[#eceef0] px-8 pb-[88px] pt-20 text-[#0a0a0a]">
        <div className="mx-auto max-w-[1240px]">
          <div className="mb-9 flex flex-wrap items-end justify-between gap-6">
            <h2 className="font-display m-0 max-w-[640px] text-balance text-[clamp(32px,4vw,50px)] font-medium leading-[1.06] tracking-[-0.01em]">
              Everything you need to scout, in one place
            </h2>
            <span className="pb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#52565e]">
              What&apos;s inside
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="flex flex-col rounded-[20px] bg-white px-[30px] pb-7 pt-[30px]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <svg width="34" height="34" viewBox="0 0 10 10" className="shrink-0">
                      {f.rects.map(([x, y], i) => (
                        <rect key={i} x={x} y={y} width="2" height="2" fill="#0a0a0a" />
                      ))}
                    </svg>
                    <h3 className="font-display m-0 text-[23px] font-semibold">
                      {f.title}
                    </h3>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em]"
                    style={
                      f.tag === "Live"
                        ? { background: "#0a0a0a", color: "#fff" }
                        : { background: "#d7dade", color: "#52565e" }
                    }
                  >
                    {f.tag}
                  </span>
                </div>
                <p className="mt-[18px] text-[16px] leading-[1.55] text-[#52565e]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
