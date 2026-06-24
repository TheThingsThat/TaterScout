export default function Footer() {
  return (
    <footer className="border-t border-[#161616] bg-black">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-8 px-8 py-[46px]">
        <span className="font-mono text-[13px] font-bold tracking-[0.26em] text-muted">
          TaterScout
        </span>
        <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-[#6b6f78]">
          TaterScout — an FTC scouting dashboard. Data from the{" "}
          <a
            href="https://ftcscout.org"
            target="_blank"
            rel="noreferrer"
            className="text-accent no-underline hover:underline"
          >
            FTCScout
          </a>{" "}
          public API. Not affiliated with FIRST.
        </p>
      </div>
    </footer>
  );
}
