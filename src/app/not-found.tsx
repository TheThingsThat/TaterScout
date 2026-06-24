import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[64vh] max-w-[1240px] place-items-center justify-center px-8 text-center">
      <div className="relative">
        <div
          className="hero-dots pointer-events-none absolute z-0 opacity-50"
          style={{
            inset: "-60px",
            WebkitMaskImage:
              "radial-gradient(320px 220px at 50% 50%, #000 0%, transparent 72%)",
            maskImage:
              "radial-gradient(320px 220px at 50% 50%, #000 0%, transparent 72%)",
          }}
        />
        <div className="relative z-[1]">
          <div className="text-[clamp(80px,14vw,150px)] font-bold leading-none tracking-[-0.02em] text-accent">
            404
          </div>
          <h1 className="mt-[18px] text-[24px] font-semibold text-[#f7f8fa]">
            Not found
          </h1>
          <p className="mt-2.5 text-[15px] text-muted">
            That team or event doesn&apos;t exist, or has no data yet.
          </p>
          <Link
            href="/"
            className="mt-[26px] inline-flex items-center gap-2.5 rounded-full bg-accent px-[22px] py-3 text-[15px] font-medium text-white no-underline transition-opacity hover:opacity-90"
          >
            Back to search <span className="text-[12px]">✛</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
