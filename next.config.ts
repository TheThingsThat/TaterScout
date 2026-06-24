import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The trajectory JSON is read at runtime via fs (not imported), so Next won't
  // trace it automatically. Force-include it in the serverless bundle so the
  // team-page trajectory charts work in production (e.g. Vercel).
  outputFileTracingIncludes: {
    "/teams/[number]": ["./src/data/trajectories-*.json"],
  },
};

export default nextConfig;
