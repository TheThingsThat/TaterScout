// Which data backend serves the public site. "convex" = granular cached
// queries against the Convex tables; anything else = the whole-file store
// (bundled JSON / Blob). The flag makes the migration reversible: flip the
// env var, redeploy, done.
export function convexBackendEnabled(): boolean {
  return process.env.DATA_BACKEND === "convex" && !!process.env.NEXT_PUBLIC_CONVEX_URL;
}
