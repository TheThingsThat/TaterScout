/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assignments from "../assignments.js";
import type * as auth from "../auth.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as match from "../match.js";
import type * as members from "../members.js";
import type * as picklist from "../picklist.js";
import type * as pit from "../pit.js";
import type * as shortlist from "../shortlist.js";
import type * as site_eventStats from "../site/eventStats.js";
import type * as site_pages from "../site/pages.js";
import type * as site_rankings from "../site/rankings.js";
import type * as site_search from "../site/search.js";
import type * as site_trajectories from "../site/trajectories.js";
import type * as sync_lib from "../sync/lib.js";
import type * as sync_state from "../sync/state.js";
import type * as sync_write from "../sync/write.js";
import type * as teams from "../teams.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assignments: typeof assignments;
  auth: typeof auth;
  events: typeof events;
  http: typeof http;
  lib: typeof lib;
  match: typeof match;
  members: typeof members;
  picklist: typeof picklist;
  pit: typeof pit;
  shortlist: typeof shortlist;
  "site/eventStats": typeof site_eventStats;
  "site/pages": typeof site_pages;
  "site/rankings": typeof site_rankings;
  "site/search": typeof site_search;
  "site/trajectories": typeof site_trajectories;
  "sync/lib": typeof sync_lib;
  "sync/state": typeof sync_state;
  "sync/write": typeof sync_write;
  teams: typeof teams;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
