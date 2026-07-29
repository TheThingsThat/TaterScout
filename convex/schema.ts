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
    timezone: v.optional(v.string()), // event-local tz, so times match the venue
    joinCode: v.string(), // scouts join with this
    adminUserId: v.id("users"), // creator
    createdAt: v.number(),
    myTeam: v.optional(v.number()), // the team this workspace scouts for (Up next)
    freeScoutMode: v.optional(v.boolean()), // scouts can scout any match, not just assigned
  }).index("by_joinCode", ["joinCode"]),

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
    farAuto: v.boolean(),
    farTele: v.boolean(),
    nearAuto: v.boolean(),
    nearTele: v.boolean(),
    canPark: v.boolean(),
    canTilt: v.boolean(),
    canClimb: v.boolean(),
    robotStatus: v.union(v.literal("full"), v.literal("minor"), v.literal("major")),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
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
});
