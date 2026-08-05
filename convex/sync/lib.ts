// Shared guard for the site-data sync writer. The worker (Next /api/refresh
// route and the seed script) authenticates with a shared secret held in the
// SYNC_SECRET env var on both sides — least-privilege vs a deploy key: it can
// only reach these sync mutations, and rotating one env var revokes it.

/** Throws unless the caller presented the deployment's sync secret. Fails
 *  CLOSED when the deployment has no secret configured. */
export function requireSyncSecret(secret: string): void {
  const want = process.env.SYNC_SECRET;
  if (!want) throw new Error("Sync is not configured (SYNC_SECRET unset).");
  // Length-safe constant-time-ish compare (no early exit on mismatch).
  if (secret.length !== want.length) throw new Error("Unauthorized.");
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= secret.charCodeAt(i) ^ want.charCodeAt(i);
  if (diff !== 0) throw new Error("Unauthorized.");
}
