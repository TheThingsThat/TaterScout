import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

// Scoped to /scout only — the rest of TaterScout stays public and untouched.
const isSignIn = createRouteMatcher(["/scout/sign-in"]);
const isScout = createRouteMatcher(["/scout", "/scout/(.*)"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const authed = await convexAuth.isAuthenticated();
  if (isSignIn(request) && authed) {
    return nextjsMiddlewareRedirect(request, "/scout");
  }
  if (isScout(request) && !isSignIn(request) && !authed) {
    return nextjsMiddlewareRedirect(request, "/scout/sign-in");
  }
});

export const config = {
  // /scout for gating, /api/auth so Convex Auth's token exchange is handled.
  matcher: ["/scout", "/scout/:path*", "/api/auth"],
};
