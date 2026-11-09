"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";

export type Me = NonNullable<FunctionReturnType<typeof api.stars.mine>>;

/**
 * The signed-in visitor (or null), shared by the header, star buttons and the
 * homepage: identical queries collapse into one subscription per tab. Signed-out
 * visitors never subscribe, so they cost Convex nothing.
 * `undefined` while sign-in state or the query is still loading.
 */
export function useMe(): Me | null | undefined {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.stars.mine, isAuthenticated ? {} : "skip");
  if (isLoading) return undefined;
  if (!isAuthenticated) return null;
  return me;
}

/**
 * End a demo: confirm, delete its data, then sign the anonymous session out. Until
 * then a demo visitor counts as signed in, so /sign-in would forward them straight
 * back instead of letting them create an account. Resolves false if they cancel.
 */
export function useEndDemo(): () => Promise<boolean> {
  const endDemo = useMutation(api.demo.end);
  const { signOut } = useAuthActions();
  return async () => {
    if (!confirm("End the demo and delete everything you created? This can't be undone.")) return false;
    await endDemo({});
    await signOut();
    return true;
  };
}

/** Where sign-in should send the visitor back to: the page they're on. */
export function signInHref(): string {
  const here = window.location.pathname + window.location.search;
  return `/sign-in?next=${encodeURIComponent(here)}`;
}
