import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <div className="prose-invert mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">About VibeScout</h1>
      <p className="text-muted">
        VibeScout pulls FIRST Tech Challenge data into a single scouting
        dashboard so you don&apos;t have to juggle multiple sites. It combines
        the kinds of views offered by ftcscout, depthftc and statcube.
      </p>

      <div className="card space-y-3 p-5 text-sm">
        <h2 className="font-semibold">Where the data comes from</h2>
        <p className="text-muted">
          All data is fetched live from the public{" "}
          <a
            href="https://ftcscout.org/api"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            FTCScout API
          </a>
          . No login required.
        </p>
      </div>

      <div className="card space-y-3 p-5 text-sm">
        <h2 className="font-semibold">What the stats mean</h2>
        <p className="text-muted">
          <strong className="text-foreground">OPR (Offensive Power Rating)</strong>{" "}
          is a least-squares estimate of how many points a team contributes to
          its alliance, computed across all of a team&apos;s matches in a season.
          It&apos;s split into <strong className="text-foreground">Auto</strong>{" "}
          (autonomous), <strong className="text-foreground">TeleOp</strong>{" "}
          (driver-controlled) and{" "}
          <strong className="text-foreground">Endgame</strong> components.
          Ranks are world-wide for the selected season.
        </p>
      </div>

      <div className="card space-y-3 p-5 text-sm">
        <h2 className="font-semibold">EPA — Expected Points Added</h2>
        <p className="text-muted">
          <strong className="text-foreground">EPA</strong> is a point-unit Elo
          derivative: a team&apos;s rating is its predicted point contribution,
          updated after every match by the gap between actual and predicted
          scores. A k-factor shrinks as a team plays more matches, and a margin
          parameter shifts the model from pure offense early in the season toward
          full win-margin later. Auto EPA is tracked separately and TeleOp EPA is
          the remainder. VibeScout replays the entire season&apos;s matches in
          order, following the{" "}
          <a
            href="https://www.statbotics.io/blog/epa"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Statbotics EPA model
          </a>{" "}
          (adapted from FRC&apos;s 3-team alliances to FTC&apos;s 2-team format).
          Unlike OPR, EPA accounts for win margin and schedule strength.
        </p>
      </div>

      <div className="card space-y-3 p-5 text-sm">
        <h2 className="font-semibold">On the roadmap</h2>
        <ul className="list-inside list-disc space-y-1 text-muted">
          <li>OPR-based match win probabilities (DepthFTC-style)</li>
          <li>Monte-Carlo event / playoff simulation</li>
          <li>Side-by-side alliance comparison for pick lists</li>
        </ul>
      </div>

      <p className="text-xs text-muted">
        VibeScout is an independent project and is not affiliated with FIRST.
      </p>
    </div>
  );
}
