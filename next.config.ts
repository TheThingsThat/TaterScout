import type { NextConfig } from "next";

// The datasets are read at runtime via fs on a path built from process.cwd()
// (data/storage.ts dataDir()), so don't leave tracing them to static analysis.
// Every route below hydrates the store — ensureLoaded() reads all three
// together — and falls back to these bundled copies when Vercel Blob is
// unavailable (over quota, which pauses the store), so the site serves
// last-commit data instead of going blank. Keep in sync with ensureLoaded()
// callers.
const DATASETS = ["./src/data/*.json"];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The scouting app performs state-changing mutations — don't let it be
        // framed, and don't let responses be MIME-sniffed.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/": DATASETS,
    "/rankings": DATASETS,
    "/events/[season]/[code]": DATASETS,
    "/teams/[number]": DATASETS,
    "/api/search": DATASETS,
    "/api/scout/import": DATASETS,
  },
};

export default nextConfig;
