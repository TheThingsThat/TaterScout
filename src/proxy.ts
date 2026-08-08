import { NextResponse, type NextRequest } from "next/server";
import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

// Scoped to /scout only — the rest of TaterScout stays public and untouched.
const isSignIn = createRouteMatcher(["/scout/sign-in"]);
const isScout = createRouteMatcher(["/scout", "/scout/(.*)"]);

/**
 * Per-IP throttle for the routes that cost real money per request: team and
 * event pages fetch the FIRST API live (several credentialed calls each) on our
 * single shared API key, and search/import do too. Unthrottled, one anonymous
 * client can burn that quota — getting the key rate-limited would take the
 * whole site down, not just the attacker.
 *
 * Deliberately a coarse per-instance bucket, not a precise global one: state is
 * per serverless instance, so the real ceiling is roughly LIMIT x instances.
 * That's fine — the goal is to stop cheap high-volume scraping from one host,
 * not to enforce an exact quota. A genuine distributed attack needs the Vercel
 * WAF (see VERCEL_SETUP.md); this costs nothing and handles the common case.
 *
 * The ceiling is deliberately generous because of who shares an IP here: a
 * whole FTC venue browsing over one NAT'd gym wifi looks like a single client.
 * A limit tuned to "one person" would fire during exactly the events this site
 * exists for. Scripted abuse runs orders of magnitude above this, and the real
 * amplification is already gone (invalid codes cost ~0 upstream calls now), so
 * this is defense-in-depth rather than the primary control.
 */
const WINDOW_MS = 60_000;
const LIMIT = 300; // requests per IP per minute across the metered routes
const hits = new Map<string, { n: number; resetAt: number }>();

// /api/status is intentionally NOT metered: it's the once-a-minute heartbeat,
// so a venue with many open tabs would spend its whole budget on it, and its
// cost is already bounded by the sync cadence + shared 15s cache.
const isMetered = createRouteMatcher([
  "/teams/(.*)",
  "/events/(.*)",
  "/api/search",
  "/api/scout/import",
]);

function rateLimited(request: NextRequest): NextResponse | null {
  if (!isMetered(request)) return null;
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  const now = Date.now();

  // Opportunistic sweep so the map can't grow without bound on a warm instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }

  const cur = hits.get(ip);
  if (!cur || cur.resetAt <= now) {
    hits.set(ip, { n: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  cur.n += 1;
  if (cur.n > LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
    return new NextResponse("Too many requests — slow down.", {
      status: 429,
      headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
    });
  }
  return null;
}

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const limited = rateLimited(request);
  if (limited) return limited;

  if (isScout(request)) {
    const authed = await convexAuth.isAuthenticated();
    if (isSignIn(request) && authed) {
      return nextjsMiddlewareRedirect(request, "/scout");
    }
    if (!isSignIn(request) && !authed) {
      return nextjsMiddlewareRedirect(request, "/scout/sign-in");
    }
  }
});

export const config = {
  // /scout for gating, /api/auth for Convex Auth's token exchange, plus the
  // metered public routes above so the rate limiter actually sees them.
  matcher: [
    "/scout",
    "/scout/:path*",
    "/api/auth",
    "/teams/:path*",
    "/events/:path*",
    "/api/search",
    "/api/scout/import",
  ],
};
