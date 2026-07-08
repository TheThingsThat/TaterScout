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
