import { NextResponse } from "next/server";
import { getRawEvents, applyComputed, persist } from "@/lib/data/store";
import { fetchDeltas, fetchAllEvents } from "@/lib/data/crawl";
import { computeSeasonData } from "@/lib/data/compute";

// The refresh must never be cached, and should run on demand.
export const dynamic = "force-dynamic";

const SEASON = 2025;
let inFlight = false;

/**
 * Incrementally pull NEW/changed data from FTCScout (cross-verified against what
 * we already have) and recompute the derived fields. No-op when nothing changed.
 */
export async function POST() {
  if (inFlight) {
    return NextResponse.json({ error: "A refresh is already running." }, { status: 409 });
  }
  inFlight = true;
  const t0 = Date.now();
  try {
    // Working copy of the ingested events; seed via a full crawl if none exists.
    let raw = await getRawEvents(SEASON);
    if (!raw) raw = await fetchAllEvents(SEASON);

    const delta = await fetchDeltas(SEASON, raw);

    if (!delta.changed) {
      return NextResponse.json({
        changed: false,
        newEvents: 0,
        updatedEvents: 0,
        newMatches: 0,
        ms: Date.now() - t0,
      });
    }

    // Recompute (EPA is global; OPR/sim-model/snapshots all derive from the set).
    const computed = computeSeasonData(SEASON, delta.events);
    applyComputed(SEASON, delta.events, computed);
    await persist(SEASON);

    return NextResponse.json({
      changed: true,
      newEvents: delta.newEvents.length,
      updatedEvents: delta.updatedEvents.length,
      newMatches: delta.newMatches,
      ms: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    inFlight = false;
  }
}
