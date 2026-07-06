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
    // Autonomous
    autoNearZone: v.boolean(),
    autoFarZone: v.boolean(),
    autoLeave: v.boolean(),
    autoUndisrupted: v.boolean(),
    autoArtifacts: v.number(), // stepper count
    // Teleop
    teleopNearZone: v.boolean(),
    teleopFarZone: v.boolean(),
    teleopArtifacts: v.number(), // stepper count
    // Endgame
    park: v.union(
      v.literal("none"),
      v.literal("simple"),
      v.literal("tilt"),
      v.literal("climb"),
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
  pitReports: defineTable({
    workspaceId: v.id("workspaces"),
    teamNumber: v.number(),
    memberId: v.id("members"),
    farAuto: v.boolean(),
    farTele: v.boolean(),
    nearAuto: v.boolean(),
    nearTele: v.boolean(),
    canFullPark: v.boolean(),
    canTiltPark: v.boolean(),
    robotStatus: v.union(v.literal("full"), v.literal("minor"), v.literal("major")),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_team", ["workspaceId", "teamNumber"]),

  // Pick-list board. owner = "primary" (admin board) or a member id (personal).
  picklists: defineTable({
    workspaceId: v.id("workspaces"),
    owner: v.union(v.literal("primary"), v.id("members")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_owner", ["workspaceId", "owner"]),

  picklistEntries: defineTable({
    workspaceId: v.id("workspaces"),
    picklistId: v.id("picklists"),
    teamNumber: v.number(),
    tier: v.union(
      v.literal("t1"),
      v.literal("t2"),
      v.literal("t3"),
      v.literal("dnp"),
      v.literal("uncat"),
    ),
    rank: v.number(), // order within its column
  })
    .index("by_picklist", ["picklistId"])
    .index("by_picklist_tier", ["picklistId", "tier"]),
});
