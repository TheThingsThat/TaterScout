"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { signInHref, useMe } from "./useMe";

const BTN =
  "inline-flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 text-[13px] transition-colors disabled:opacity-60";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.8l2.84 5.76 6.36.92-4.6 4.48 1.09 6.33L12 17.3l-5.69 2.99 1.09-6.33-4.6-4.48 6.36-.92z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Star / unstar a team (team-page banner). Signed-out visitors are sent to sign in.
 *  `compact`: icon only, for the homepage list (shown to signed-in users only). */
export default function StarButton({ team, compact = false }: { team: number; compact?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const setStar = useMutation(api.stars.set).withOptimisticUpdate((store, { team, starred }) => {
    const cur = store.getQuery(api.stars.mine, {});
    if (!cur) return;
    const teams = starred
      ? [...new Set([...cur.teams, team])].sort((a, b) => a - b)
      : cur.teams.filter((t) => t !== team);
    store.setQuery(api.stars.mine, {}, { ...cur, teams });
  });

  const starred = !!me && me.teams.includes(team);

  if (me === undefined) {
    return (
      <span className={`${BTN} border-border-strong text-muted opacity-60`} aria-hidden>
        <StarIcon filled={false} /> Star
      </span>
    );
  }

  if (me === null) {
    return (
      <button
        onClick={() => router.push(signInHref())}
        title="Sign in to star this team and follow it on your homepage"
        className={`${BTN} border-border-strong text-muted hover:border-border-hover hover:text-foreground`}
      >
        <StarIcon filled={false} /> Star
      </button>
    );
  }

  if (me.isDemo) {
    return (
      <span
        title="Create an account to star teams — demo data is deleted when the demo ends"
        className={`${BTN} cursor-not-allowed border-border-strong text-muted opacity-60`}
      >
        <StarIcon filled={false} /> Star
      </span>
    );
  }

  async function toggle() {
    try {
      await setStar({ team, starred: !starred });
    } catch (e) {
      alert(e instanceof ConvexError ? String(e.data) : "Couldn't save that. Please try again.");
    }
  }

  if (compact) {
    return (
      <button
        onClick={toggle}
        aria-pressed={starred}
        aria-label={starred ? `Unstar team ${team}` : `Star team ${team}`}
        title={starred ? "Unstar" : "Star"}
        className={`shrink-0 rounded-md p-1 transition-colors ${starred ? "text-gold hover:text-[color-mix(in_srgb,var(--gold)_70%,var(--heading))]" : "text-muted hover:text-foreground"}`}
      >
        <StarIcon filled={starred} />
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      aria-pressed={starred}
      title={starred ? "Unstar — remove from your homepage" : "Star — follow this team on your homepage"}
      className={`${BTN} ${
        starred
          ? "border-gold/50 bg-gold/[0.08] text-gold hover:border-gold"
          : "border-border-strong text-muted hover:border-border-hover hover:text-foreground"
      }`}
    >
      <StarIcon filled={starred} /> {starred ? "Starred" : "Star"}
    </button>
  );
}
