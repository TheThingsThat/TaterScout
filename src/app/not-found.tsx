import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div>
        <p className="text-6xl font-black brand-gradient">404</p>
        <h1 className="mt-4 text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-muted">
          That team or event doesn&apos;t exist, or has no data yet.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background"
        >
          Back to search
        </Link>
      </div>
    </div>
  );
}
