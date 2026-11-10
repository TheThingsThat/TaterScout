import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@convex/_generated/api";

export const dynamic = "force-dynamic";

/**
 * Tab-close target for demo mode.
 *
 * This exists because `navigator.sendBeacon` can't set an Authorization header,
 * so the browser can't call the Convex mutation directly on unload. It CAN send
 * cookies, which is where Convex Auth keeps the session — so we read the token
 * server-side and make the authenticated call here.
 *
 * It calls demo.leave, which only shortens the session's expiry: a reload or
 * a second tab closing fires the same beacon, so wiping here would delete a
 * demo that's still in use. The reaper does the deleting; "End demo" calls
 * demo.end directly to wipe at once.
 *
 * The mutation identifies the user from that token and touches only their own
 * demo session, so an unauthenticated or already-wiped call is a harmless no-op
 * rather than something an attacker can point at someone else's data.
 */
export async function POST() {
  try {
    const token = await convexAuthNextjsToken();
    if (!token) return NextResponse.json({ wiped: 0 });
    const res = await fetchMutation(api.demo.leave, {}, { token });
    return NextResponse.json(res);
  } catch {
    // Never surface an error on unload — the reaper cron covers any miss.
    return NextResponse.json({ wiped: 0 });
  }
}
