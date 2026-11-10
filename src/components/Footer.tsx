import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-background">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-8 px-8 py-[46px]">
        <span className="font-mono text-[13px] font-bold tracking-[0.26em] text-muted">
          TaterScout
        </span>
        <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-dim">
          TaterScout — an FTC scouting dashboard. Data from the{" "}
          <a
            href="https://frc-events.firstinspires.org/services/API"
            target="_blank"
            rel="noreferrer"
            className="text-accent no-underline hover:underline"
          >
            official FIRST Tech Challenge Events API
          </a>
          . Not affiliated with FIRST.{" "}
          <Link href="/status" className="text-muted no-underline hover:text-foreground">
            System status
          </Link>
        </p>
      </div>
    </footer>
  );
}
