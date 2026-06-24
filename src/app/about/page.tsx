import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-[#1a1a1a] bg-surface px-[26px] py-6">
      <h2 className="m-0 text-[18px] font-semibold text-foreground">{title}</h2>
      <div className="mt-3 text-[15px] leading-[1.6] text-muted">{children}</div>
    </div>
  );
}

const STRONG = "font-semibold text-[#e7eaf0]";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[760px] px-5 pb-6 pt-[52px] sm:px-8">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6b6f78]">
        About
      </div>
      <h1 className="mt-3 text-[clamp(32px,4.5vw,52px)] font-semibold tracking-[-0.01em] text-[#f7f8fa]">
        About TaterScout
      </h1>
      <p className="mt-[18px] text-[17px] leading-[1.6] text-muted">
        TaterScout pulls FIRST Tech Challenge data into a single scouting
        dashboard so you don&apos;t have to juggle multiple sites — team ratings,
        rankings, match results, and season trajectories in one place.
      </p>

      <div className="mt-[34px] grid gap-4">
        <Card title="Where the data comes from">
          All data is fetched live from the public{" "}
          <a
            href="https://ftcscout.org/api"
            target="_blank"
            rel="noreferrer"
            className="text-accent no-underline hover:underline"
          >
            FTCScout API
          </a>
          . No login required.
        </Card>

        <Card title="What the stats mean">
          <strong className={STRONG}>OPR (Offensive Power Rating)</strong> is a
          least-squares estimate of how many points a team contributes to its
          alliance, computed across all of a team&apos;s matches in a season.
          It&apos;s split into <strong className={STRONG}>Auto</strong>{" "}
          (autonomous), <strong className={STRONG}>TeleOp</strong>{" "}
          (driver-controlled) and <strong className={STRONG}>Endgame</strong>{" "}
          components. Ranks are world-wide for the selected season.
        </Card>

        <Card title="EPA — Expected Points Added">
          <strong className={STRONG}>EPA</strong> is a point-unit Elo derivative:
          a team&apos;s rating is its predicted point contribution, updated after
          every match by the gap between actual and predicted scores. A k-factor
          shrinks as a team plays more matches, and a margin parameter shifts the
          model from pure offense early in the season toward full win-margin
          later. Auto EPA is tracked separately and TeleOp EPA is the remainder.
          TaterScout replays the entire season&apos;s matches in order, following
          the{" "}
          <a
            href="https://www.statbotics.io/blog/epa"
            target="_blank"
            rel="noreferrer"
            className="text-accent no-underline hover:underline"
          >
            Statbotics EPA model
          </a>{" "}
          (adapted from FRC&apos;s 3-team alliances to FTC&apos;s 2-team format).
          Unlike OPR, EPA accounts for win margin and schedule strength.
        </Card>

        <Card title="On the roadmap">
          <ul className="m-0 list-disc pl-5 leading-[1.8]">
            <li>EPA/OPR-based match win probabilities</li>
            <li>Monte-Carlo event / playoff simulation</li>
            <li>Side-by-side alliance comparison for pick lists</li>
          </ul>
        </Card>
      </div>

      <p className="mt-7 text-[13px] text-[#6b6f78]">
        TaterScout is an independent project and is not affiliated with FIRST.
      </p>
    </div>
  );
}
