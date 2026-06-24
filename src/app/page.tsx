import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import { getSeasonSnapshot } from "@/lib/ftc/queries";
import { CURRENT_SEASON, seasonFull } from "@/lib/season";

export const revalidate = 3600;

async function SeasonStrip() {
  let snap: { activeTeamsCount: number; matchesPlayedCount: number } | null =
    null;
  try {
    snap = await getSeasonSnapshot(CURRENT_SEASON);
  } catch {
    snap = null;
  }
  const items = [
    { label: "Season", value: seasonFull(CURRENT_SEASON) },
    {
      label: "Active teams",
      value: snap ? snap.activeTeamsCount.toLocaleString() : "—",
    },
    {
      label: "Matches played",
      value: snap ? snap.matchesPlayedCount.toLocaleString() : "—",
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="card px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-muted">
            {it.label}
          </div>
          <div className="mt-0.5 text-lg font-semibold">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

const FEATURES = [
  {
    title: "Team profiles",
    body: "EPA and OPR ratings with auto/TeleOp splits, world rankings and a full event history.",
    tag: "Live",
  },
  {
    title: "Event dashboards",
    body: "Rankings by OPR, the full match schedule, and red/blue results with winners highlighted.",
    tag: "Live",
  },
  {
    title: "Match predictions",
    body: "OPR-based win probabilities and a Monte-Carlo playoff simulator, à la DepthFTC.",
    tag: "Soon",
  },
  {
    title: "Alliance compare",
    body: "Stack teams side-by-side to prep alliance selection and scouting strategy.",
    tag: "Soon",
  },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="pt-6 text-center">
        <span className="inline-block rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          Powered by the FTCScout API
        </span>
        <h1 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          All your FTC scouting,{" "}
          <span className="brand-gradient">one dashboard.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-balance text-muted">
          Search any FIRST Tech Challenge team or event to see OPR, rankings,
          and match results — the stats from ftcscout, depthftc and statcube,
          unified.
        </p>
        <div className="mx-auto mt-6 max-w-md">
          <SearchBar autoFocus />
        </div>
        <p className="mt-3 text-xs text-muted">
          Try{" "}
          <Link href="/teams/14584" className="text-accent hover:underline">
            team 14584
          </Link>
          , search an event, or browse the{" "}
          <Link href="/rankings" className="text-accent hover:underline">
            full rankings
          </Link>
          .
        </p>
      </section>

      <SeasonStrip />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          What&apos;s inside
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{f.title}</h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    f.tag === "Live"
                      ? "bg-accent-2/15 text-accent-2"
                      : "bg-surface-2 text-muted"
                  }`}
                >
                  {f.tag}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
