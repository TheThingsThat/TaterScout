import { NextResponse, type NextRequest } from "next/server";
import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { safeNext } from "@/lib/safeNext";

// Sign-in is site-wide (stars on public pages), but only /scout requires it.
const isSignIn = createRouteMatcher(["/sign-in"]);
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

// /api/starred looks up to 25 teams per request and /api/region 10, each a possible
// FIRST call pair, so they share their own budget counted in TEAMS: 600/min is 24
// full 25-star homepage loads per IP, about what a gym's shared wifi could need, and
// keeps the worst case per minute near the team pages' own (300 x 3 FIRST calls).
const STARRED_TEAM_LIMIT = 600;
const starredHits = new Map<string, { n: number; resetAt: number }>();

// /api/status is intentionally NOT metered: it's the once-a-minute heartbeat,
// so a venue with many open tabs would spend its whole budget on it, and its
// cost is already bounded by the sync cadence (it reads nothing itself).
const isMetered = createRouteMatcher([
  "/teams/(.*)",
  "/events/(.*)",
  "/api/search",
  "/api/starred",
  "/api/region",
  "/api/scout/import",
]);

/** Count `cost` against one IP's bucket; a 429 response once it's over `limit`. */
function charge(
  buckets: Map<string, { n: number; resetAt: number }>,
  ip: string,
  cost: number,
  limit: number,
  now: number,
): NextResponse | null {
  // Opportunistic sweep so the map can't grow without bound on a warm instance.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  let cur = buckets.get(ip);
  if (!cur || cur.resetAt <= now) {
    cur = { n: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, cur);
  }
  cur.n += cost;
  if (cur.n > limit) {
    const retryAfter = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
    return new NextResponse("Too many requests — slow down.", {
      status: 429,
      headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
    });
  }
  return null;
}

function rateLimited(request: NextRequest): NextResponse | null {
  if (!isMetered(request)) return null;
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  const now = Date.now();
  if (request.nextUrl.pathname === "/api/starred") {
    const teams = new Set((request.nextUrl.searchParams.get("teams") ?? "").split(",").filter(Boolean));
    return charge(starredHits, ip, Math.max(1, Math.min(25, teams.size)), STARRED_TEAM_LIMIT, now);
  }
  if (request.nextUrl.pathname === "/api/region") {
    return charge(starredHits, ip, 10, STARRED_TEAM_LIMIT, now); // its top 10
  }
  return charge(hits, ip, 1, LIMIT, now);
}

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const limited = rateLimited(request);
    if (limited) return limited;

    if (isSignIn(request)) {
      // Already signed in (including straight back from Google): go where they were headed.
      if (await convexAuth.isAuthenticated()) {
        return nextjsMiddlewareRedirect(request, safeNext(request.nextUrl.searchParams.get("next")));
      }
    } else if (request.nextUrl.pathname === "/scout/sign-in") {
      return nextjsMiddlewareRedirect(request, "/sign-in?next=/scout"); // the old address
    } else if (isScout(request) && !(await convexAuth.isAuthenticated())) {
      const next = request.nextUrl.pathname + request.nextUrl.search;
      return nextjsMiddlewareRedirect(request, `/sign-in?next=${encodeURIComponent(next)}`);
    }
  },
  {
    // OAuth codes are exchanged only where Google sends people back. Without this,
    // any matched page with ?code= would run a Convex sign-in (and clear the
    // visitor's session when it failed) before the rate limiter.
    shouldHandleCode: (request) => isSignIn(request),
  },
);

export const config = {
  // /sign-in for the OAuth code exchange, /scout for gating, /api/auth for Convex
  // Auth's token exchange, plus the metered public routes above so the rate
  // limiter actually sees them.
  matcher: [
    "/sign-in",
    "/scout",
    "/scout/:path*",
    "/api/auth",
    "/teams/:path*",
    "/events/:path*",
    "/api/search",
    "/api/starred",
    "/api/region",
    "/api/scout/import",
  ],
};
