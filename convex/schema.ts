// Convex schema for the TaterScout scouting subsystem (MVP).
// Multi-tenant: every domain row carries `workspaceId`; server functions
// validate the caller's membership. Auth (users/sessions) comes from Convex
// Auth via `...authTables`.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  // Convex Auth: users, authSessions, authAccounts, authVerifications, …
  ...authTables,

  // A scouting workspace = one team's board for one event (the tenant boundary).
  workspaces: defineTable({
    name: v.string(),
    season: v.number(),
    eventCode: v.string(),
    eventName: v.optional(v.string()),
    joinCode: v.string(), // scouts join with this
    adminUserId: v.id("users"), // creator
    createdAt: v.number(),
    myTeam: v.optional(v.number()), // the team this workspace scouts for (Up next)
    freeScoutMode: v.optional(v.boolean()), // scouts can scout any match, not just assigned
    isDemo: v.optional(v.boolean()), // throwaway: wiped when the demo session ends
  })
    .index("by_joinCode", ["joinCode"])
    .index("by_adminUser", ["adminUserId"]),

  // A throwaway demo session. Its existence is what marks a user as a demo user
  // (so the Convex Auth `users` table stays untouched). Everything the session
  // created is deleted when it ends — either immediately via the tab-close
  // beacon, or by the reaper cron once `expiresAt` passes, which is the real
  // guarantee since a crash or force-quit fires no unload event at all.
  demoSessions: defineTable({
    userId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(), // pushed forward while the tab is open (demo.touch)
  })
    .index("by_user", ["userId"])
    .index("by_expiresAt", ["expiresAt"]),

  // Teams a signed-in user follows on the public site (homepage + team pages).
  // Season-independent: a star is on the team, not on one season of it.
  stars: defineTable({
    userId: v.id("users"),
    team: v.number(),
  }).index("by_user_team", ["userId", "team"]),

  // The one region a user follows on the homepage (its top 10 teams). At most one row per user.
  regionStars: defineTable({
    userId: v.id("users"),
    region: v.string(), // FIRST home-region code, e.g. "USTXCE"
  }).index("by_user", ["userId"]),

  // Membership of a user in a workspace, with role.
  members: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    name: v.string(), // display name in this workspace
    role: v.union(v.literal("admin"), v.literal("scout")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  // Imported team snapshot (from FIRST + TaterScout EPA/OPR at import time).
  teamEvents: defineTable({
    workspaceId: v.id("workspaces"),
    teamNumber: v.number(),
    name: v.string(),
    region: v.union(v.string(), v.null()),
    rank: v.union(v.number(), v.null()),
    epa: v.union(v.number(), v.null()),
    oprNp: v.union(v.number(), v.null()),
    oprAuto: v.union(v.number(), v.null()),
    oprTele: v.union(v.number(), v.null()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_team", ["workspaceId", "teamNumber"]),

  // Imported qualification schedule (with our predicted start time).
  matches: defineTable({
    workspaceId: v.id("workspaces"),
    matchNumber: v.number(),
    red: v.array(v.number()),
    blue: v.array(v.number()),
    predictedTime: v.union(v.number(), v.null()), // ms epoch
    actualStartTime: v.optional(v.union(v.number(), v.null())), // ms epoch, once played
    redScore: v.optional(v.union(v.number(), v.null())), // final total, once played
    blueScore: v.optional(v.union(v.number(), v.null())),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_match", ["workspaceId", "matchNumber"]),

  // "One scout per robot per match": a claim on (match, team) within a workspace.
  matchClaims: defineTable({
    workspaceId: v.id("workspaces"),
    matchNumber: v.number(),
    teamNumber: v.number(),
    memberId: v.id("members"),
  })
    .index("by_workspace_match_team", ["workspaceId", "matchNumber", "teamNumber"])
    .index("by_member", ["memberId"]),

  matchReports: defineTable({
    workspaceId: v.id("workspaces"),
    matchNumber: v.number(),
    teamNumber: v.number(),
    memberId: v.id("members"),
    // Autonomous — zone is a single mutually-exclusive choice.
    autoZone: v.union(v.literal("far"), v.literal("near"), v.literal("none")),
    autoLeave: v.boolean(),
    autoUndisrupted: v.boolean(),
    autoArtifacts: v.number(), // stepper count
    // Teleop
    teleopZone: v.union(v.literal("far"), v.literal("near"), v.literal("none")),
    teleopArtifacts: v.number(), // stepper count
    // Endgame — single mutually-exclusive choice.
    endgame: v.union(
      v.literal("park"),
      v.literal("tilt"),
      v.literal("climb"),
      v.literal("none"),
    ),
    // Robot status
    malfunctions: v.array(v.string()), // drivetrain | turret | intake | shooter
    malfunctionNote: v.optional(v.string()),
    tags: v.array(v.string()), // fast | accurate | good driver | plays defense | inconsistent
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_team", ["workspaceId", "teamNumber"])
    .index("by_workspace_match", ["workspaceId", "matchNumber"]),

  // Pit scouting: one report per team (what the robot appears capable of).
  // Same vocabulary as match scouting, but capability is multi-select.
  pitReports: defineTable({
    workspaceId: v.id("workspaces"),
    teamNumber: v.number(),
    memberId: v.id("members"),
    // BIOBUZZ pit form. Optional only because reports saved by the old form lack them.
    hasAuto: v.optional(v.boolean()),
    autoCount: v.optional(v.number()), // drawings live in pitAutos (read only on demand)
    flower: v.optional(v.boolean()), // can score in the FLOWERS
    scoring: v.optional(v.union(v.literal("pollen"), v.literal("pollenNectar"))),
    photoId: v.optional(v.id("_storage")), // robot photo, compressed on the phone
    robotStatus: v.union(v.literal("full"), v.literal("minor"), v.literal("major")),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
    // DECODE (2025) pit form fields, kept only so test reports still validate until
    // they're purged (workspaces.purgeSeason); nothing writes them any more.
    farAuto: v.optional(v.boolean()),
    farTele: v.optional(v.boolean()),
    nearAuto: v.optional(v.boolean()),
    nearTele: v.optional(v.boolean()),
    canPark: v.optional(v.boolean()),
    canTilt: v.optional(v.boolean()),
    canClimb: v.optional(v.boolean()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_team", ["workspaceId", "teamNumber"]),

  // A team's auto drawings, apart from pitReports so the workspace-wide queries that
  // read every pit report don't pull every drawing. `strokes` is JSON number[][], each
  // stroke a flat [x, y, x, y, …] list on a 0–1000 grid over the field (lib/autoDraw.ts).
  pitAutos: defineTable({
    workspaceId: v.id("workspaces"),
    teamNumber: v.number(),
    autos: v.array(
      v.object({
        name: v.string(),
        side: v.union(v.literal("red"), v.literal("blue")),
        strokes: v.string(),
      }),
    ),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_team", ["workspaceId", "teamNumber"]),

  // Admin-delegated scouting assignments. kind="match" carries a matchNumber;
  // kind="pit" is per-team (no match). `rank` orders a scout's own list.
  assignments: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.union(v.literal("match"), v.literal("pit")),
    memberId: v.id("members"),
    teamNumber: v.number(),
    matchNumber: v.optional(v.number()),
    rank: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_kind", ["workspaceId", "kind"])
    .index("by_workspace_member", ["workspaceId", "memberId"])
    .index("by_workspace_kind_match_team", ["workspaceId", "kind", "matchNumber", "teamNumber"]),

  // A member's private shortlist (manual add + drag rank), separate from the
  // filter/sort ranking view.
  shortlist: defineTable({
    workspaceId: v.id("workspaces"),
    memberId: v.id("members"),
    teamNumber: v.number(),
    rank: v.number(),
  }).index("by_workspace_member", ["workspaceId", "memberId"]),

  // ==========================================================================
  // PUBLIC SITE season data (read by the analytics site; written ONLY by the
  // sync worker via the secret-guarded mutations in convex/sync/). Replaces the
  // whole-file JSON blobs on Vercel Blob. All season-scoped for future backfill.
  // ==========================================================================

  // One doc per season: everything small the old rankings file carried besides
  // the team rows (counts, regions, priors, sim model, world record) plus
  // denormalized counts so leaderboard pagination math needs no scans.
  seasonMeta: defineTable({
    season: v.number(),
    computedAt: v.string(),
    matchCount: v.number(),
    teamCount: v.number(),
    regions: v.array(v.string()),
    regionCounts: v.record(v.string(), v.number()), // region -> team count
    sortCounts: v.record(v.string(), v.number()), // sortKey -> rows with that stat
    cyclePriors: v.union(
      v.null(),
      v.object({
        overallSec: v.number(),
        byTypeSec: v.record(v.string(), v.number()),
        sampleCount: v.number(),
      }),
    ),
    // The Monte-Carlo sim model is a small opaque blob to the DB.
    simModel: v.union(v.null(), v.any()),
    worldRecord: v.union(
      v.null(),
      v.object({
        eventCode: v.string(),
        eventName: v.union(v.string(), v.null()),
        eventStart: v.union(v.string(), v.null()),
        score: v.number(),
        teams: v.array(v.object({ number: v.number(), name: v.string() })),
      }),
    ),
  }).index("by_season", ["season"]),

  // One doc per (season, team) — the leaderboard row (~280B). Dense rk* fields
  // double as offset pagination: global page N = rank range [N*50+1, (N+1)*50].
  seasonTeams: defineTable({
    season: v.number(),
    team: v.number(),
    numberStr: v.string(), // "641" — number-prefix search via index range
    name: v.string(),
    region: v.union(v.string(), v.null()),
    n: v.number(),
    epa: v.union(v.number(), v.null()),
    epaAuto: v.union(v.number(), v.null()),
    epaTele: v.union(v.number(), v.null()),
    oprNp: v.union(v.number(), v.null()),
    oprAuto: v.union(v.number(), v.null()),
    oprTele: v.union(v.number(), v.null()),
    rkEpa: v.union(v.number(), v.null()),
    rkEpaAuto: v.union(v.number(), v.null()),
    rkEpaTele: v.union(v.number(), v.null()),
    rkOprNp: v.union(v.number(), v.null()),
    rkOprAuto: v.union(v.number(), v.null()),
    rkOprTele: v.union(v.number(), v.null()),
    // Expected hive tips a robot adds per match (BIOBUZZ count EPA). Never sorted
    // on, so no index; absent on seasons and rows without counts.
    tipsAuto: v.optional(v.union(v.number(), v.null())),
    tipsTele: v.optional(v.union(v.number(), v.null())),
  })
    .index("by_season_team", ["season", "team"])
    .index("by_season_numberStr", ["season", "numberStr"])
    .index("by_season_rkEpa", ["season", "rkEpa"])
    .index("by_season_rkEpaAuto", ["season", "rkEpaAuto"])
    .index("by_season_rkEpaTele", ["season", "rkEpaTele"])
    .index("by_season_rkOprNp", ["season", "rkOprNp"])
    .index("by_season_rkOprAuto", ["season", "rkOprAuto"])
    .index("by_season_rkOprTele", ["season", "rkOprTele"])
    .index("by_season_region_rkEpa", ["season", "region", "rkEpa"])
    .index("by_season_region_rkOprNp", ["season", "region", "rkOprNp"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["season"] }),

  // One SELF-CONTAINED doc per (season, team): trajectory points + only the
  // events this team attended. Excluded from every bulk query — point reads
  // only (the Statbotics pattern that keeps 7MB off the hot path).
  seasonTrajectories: defineTable({
    season: v.number(),
    team: v.number(),
    t0: v.number(),
    events: v.array(
      v.object({
        c: v.string(),
        n: v.union(v.string(), v.null()),
        s: v.union(v.string(), v.null()),
      }),
    ),
    // Rows of [dtMin, localEventIdx, playoff, epaAuto, epaTele, oprAuto|null, oprTele|null, noShow?, num?, series?],
    // as a JSON string: about half the size of the array form. Every write uses it;
    // `points` (the array form) survives only on rows no reseed has touched, e.g.
    // teams that dropped out of a season's data, which a seed never deletes.
    pointsJson: v.optional(v.string()),
    points: v.optional(v.array(v.array(v.union(v.number(), v.null())))),
  }).index("by_season_team", ["season", "team"]),

  // One doc per (season, event): team -> [preTot, preAuto, postTot, postAuto, oprNp, oprAuto].
  seasonEventStats: defineTable({
    season: v.number(),
    code: v.string(),
    rows: v.record(v.string(), v.array(v.union(v.number(), v.null()))),
  }).index("by_season_code", ["season", "code"]),

  // One doc per (season, event): the search-index row for event search.
  seasonEvents: defineTable({
    season: v.number(),
    code: v.string(),
    name: v.union(v.string(), v.null()),
    searchText: v.string(), // name ?? code (search field must be a string)
    start: v.union(v.string(), v.null()),
    type: v.string(),
    city: v.union(v.string(), v.null()),
    state: v.union(v.string(), v.null()),
    country: v.union(v.string(), v.null()),
  })
    .index("by_season_code", ["season", "code"])
    .searchIndex("search_name", { searchField: "searchText", filterFields: ["season"] }),

  // Sync coordination (replaces the meta-{season} blob). The claim mutation is
  // a transactional compare-and-set — actually fixes the multi-instance race.
  syncMeta: defineTable({
    season: v.number(),
    lastSyncAt: v.number(),
    nextCheckAt: v.number(),
    lastWideAt: v.number(),
    lastLongSweepAt: v.optional(v.number()), // daily ±14/+3-day sweep
    lastRankSyncAt: v.number(), // daily rank-reconcile cadence
    lastChangedAt: v.number(), // when match data last changed (drives quiet back-off)
    // When a run last claimed the slot. Newer than lastSyncAt (which only `finish`
    // stamps) once the hold has passed means that run died or threw: the status page.
    lastAttemptAt: v.optional(v.number()),
    failedRuns: v.optional(v.number()), // runs in a row that claimed but never finished
    lastEventsChecked: v.optional(v.number()), // events the last finished run looked at
    lastReadFailures: v.optional(v.number()), // of those, how many FIRST wouldn't serve
    // The sync worker's state file (raw events + fingerprints, gzipped JSON,
    // ~2MB — far over the 1MB doc limit, hence file storage). One file per
    // season; commitWorkerState deletes the previous one.
    workerStateId: v.optional(v.id("_storage")),
    workerStateSavedAt: v.optional(v.number()),
  }).index("by_season", ["season"]),

  // Upstream freshness tokens (Statbotics pattern): Last-Modified per FIRST API
  // path, so the change gate turns no-op syncs into a handful of 304s.
  upstreamFreshness: defineTable({
    season: v.number(),
    path: v.string(), // e.g. "matches/USFLCMPSCOT"
    lastModified: v.string(),
    checkedAt: v.number(),
  }).index("by_season_path", ["season", "path"]),
});
