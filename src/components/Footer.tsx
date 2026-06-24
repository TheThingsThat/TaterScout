export default function Footer() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted">
        <p>
          VibeScout — a unified FTC scouting dashboard. Data from the{" "}
          <a
            href="https://ftcscout.org"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            FTCScout
          </a>{" "}
          public API. Not affiliated with FIRST.
        </p>
        <p className="mt-1">
          Stats use OPR (Offensive Power Rating) — a least-squares estimate of a
          team&apos;s scoring contribution.
        </p>
      </div>
    </footer>
  );
}
