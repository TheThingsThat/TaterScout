import { ConvexError } from "convex/values";

/**
 * The user-facing text for a failed Convex call.
 *
 * Production Convex redacts plain `Error` messages to "Server Error" (dev shows
 * them, so this only appears after deploy). Backend failures a person can
 * legitimately hit are thrown as `ConvexError` via `convex/lib.ts#fail`, whose
 * payload survives; anything else is a genuine fault and gets the caller's
 * fallback instead of leaking a request id.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ConvexError) return String(e.data);
  return fallback;
}
