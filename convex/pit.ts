import { action, internalMutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireMember, requirePitAccess, checkLen, fail } from "./lib";

/** A report as members see it: photo as a URL (never the raw file id, which would
 *  let a member point another report at it) plus the team's auto drawings. */
export async function pitView(ctx: QueryCtx, report: Doc<"pitReports"> | null) {
  if (!report) return null;
  const { photoId, ...rest } = report;
  const drawings = await ctx.db
    .query("pitAutos")
    .withIndex("by_workspace_team", (q) => q.eq("workspaceId", report.workspaceId).eq("teamNumber", report.teamNumber))
    .unique();
  return {
    ...rest,
    autos: drawings?.autos ?? [],
    photoUrl: photoId ? await ctx.storage.getUrl(photoId) : null,
  };
}

export const get = query({
  args: { workspaceId: v.id("workspaces"), teamNumber: v.number() },
  handler: async (ctx, { workspaceId, teamNumber }) => {
    await requireMember(ctx, workspaceId);
    const report = await ctx.db
      .query("pitReports")
      .withIndex("by_workspace_team", (q) =>
        q.eq("workspaceId", workspaceId).eq("teamNumber", teamNumber),
      )
      .unique();
    return await pitView(ctx, report);
  },
});

export const MAX_AUTOS = 4;
export const MAX_STROKES = 80; // lines per auto drawing
const MAX_POINTS = 4000; // coordinates (x and y) per line, after simplification
export const MAX_STROKES_JSON = 40_000; // characters per drawing: a busy one is ~5–15k
const MAX_PHOTO_BYTES = 1_000_000; // the phone compresses to ~100–300 KB

/** Reject a drawing that isn't number[][] of flat, even-length 0–1000 coordinate lists. */
function checkStrokes(json: string): void {
  if (json.length > MAX_STROKES_JSON) fail("That auto drawing is too detailed to save. Try fewer lines.");
  let strokes: unknown;
  try {
    strokes = JSON.parse(json);
  } catch {
    fail("Couldn't read that auto drawing.");
  }
  if (!Array.isArray(strokes) || strokes.length > MAX_STROKES) fail("Too many lines in one auto drawing.");
  for (const s of strokes) {
    if (!Array.isArray(s) || s.length < 2 || s.length % 2 || s.length > MAX_POINTS) fail("Couldn't read that auto drawing.");
    for (const c of s) if (!Number.isInteger(c) || c < 0 || c > 1000) fail("Couldn't read that auto drawing.");
  }
}

const formArgs = {
  workspaceId: v.id("workspaces"),
  teamNumber: v.number(),
  hasAuto: v.boolean(),
  autos: v.array(
    v.object({
      name: v.string(),
      side: v.union(v.literal("red"), v.literal("blue")),
      strokes: v.string(),
    }),
  ),
  flower: v.boolean(),
  scoring: v.union(v.literal("pollen"), v.literal("pollenNectar")),
  robotStatus: v.union(v.literal("full"), v.literal("minor"), v.literal("major")),
  notes: v.optional(v.string()),
};

/**
 * Save a team's pit report (one per team, editable). `photo`: undefined keeps the
 * current robot photo, null removes it, bytes (a JPEG the phone already shrank)
 * replace it. The photo is stored here and linked in the same call, so there are
 * no upload URLs to abuse and a failed save never leaves a stray file behind.
 */
export const save = action({
  args: { ...formArgs, photo: v.optional(v.union(v.bytes(), v.null())) },
  handler: async (ctx, { photo, ...form }): Promise<Id<"pitReports">> => {
    let photoId: Id<"_storage"> | null | undefined = photo === null ? null : undefined;
    if (photo) {
      if (photo.byteLength > MAX_PHOTO_BYTES) throw new ConvexError("That photo is too large. Try taking it again.");
      photoId = await ctx.storage.store(new Blob([photo], { type: "image/jpeg" }));
    }
    try {
      return await ctx.runMutation(internal.pit.upsert, { ...form, photoId });
    } catch (e) {
      // An action isn't a transaction: undo the store ourselves.
      if (photoId) await ctx.storage.delete(photoId);
      throw e;
    }
  },
});

/** The transactional half of `save`. The caller's identity carries through, so
 *  pit access is checked here. `photoId` only ever comes from `save`. */
export const upsert = internalMutation({
  args: { ...formArgs, photoId: v.optional(v.union(v.id("_storage"), v.null())) },
  handler: async (ctx, args) => {
    const member = await requirePitAccess(ctx, args.workspaceId, args.teamNumber);
    checkLen(args.notes, 1000, "Notes");
    if (args.autos.length > MAX_AUTOS) fail(`Up to ${MAX_AUTOS} autos per team.`);
    for (const a of args.autos) {
      checkLen(a.name, 40, "Auto name");
      checkStrokes(a.strokes);
    }

    const existing = await ctx.db
      .query("pitReports")
      .withIndex("by_workspace_team", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("teamNumber", args.teamNumber),
      )
      .unique();

    let photoId = existing?.photoId;
    if (args.photoId !== undefined) {
      if (existing?.photoId) await ctx.storage.delete(existing.photoId).catch(() => {});
      photoId = args.photoId ?? undefined;
    }

    const autos = args.hasAuto ? args.autos : [];
    // Replace, not patch: a report from the old (DECODE) form sheds its old fields.
    const doc = {
      workspaceId: args.workspaceId,
      teamNumber: args.teamNumber,
      memberId: member._id,
      hasAuto: args.hasAuto,
      autoCount: autos.length,
      flower: args.flower,
      scoring: args.scoring,
      ...(photoId ? { photoId } : {}),
      robotStatus: args.robotStatus,
      notes: args.notes,
      updatedAt: Date.now(),
    };
    const id = existing ? (await ctx.db.replace(existing._id, doc), existing._id) : await ctx.db.insert("pitReports", doc);

    const drawings = await ctx.db
      .query("pitAutos")
      .withIndex("by_workspace_team", (q) => q.eq("workspaceId", args.workspaceId).eq("teamNumber", args.teamNumber))
      .unique();
    if (autos.length === 0) {
      if (drawings) await ctx.db.delete(drawings._id);
    } else if (drawings) {
      await ctx.db.patch(drawings._id, { autos });
    } else {
      await ctx.db.insert("pitAutos", { workspaceId: args.workspaceId, teamNumber: args.teamNumber, autos });
    }
    return id;
  },
});
