"use client";

import { useRouter } from "next/navigation";
import { useSetRegion } from "./StarredRegion";
import { signInHref, useMe } from "./useMe";

const BTN =
  "whitespace-nowrap rounded-full border px-3.5 py-[9px] text-[13px] transition-colors disabled:opacity-60";

/** Rankings page: follow the filtered region on the homepage (one region at a time). */
export default function RegionStarButton({ region }: { region: string }) {
  const me = useMe();
  const router = useRouter();
  const setRegion = useSetRegion();

  if (me === undefined) return <span className={`${BTN} border-border-strong text-muted opacity-60`}>☆ Star region</span>;
  if (me === null) {
    return (
      <button
        onClick={() => router.push(signInHref())}
        title="Sign in to follow this region's top 10 on your homepage"
        className={`${BTN} border-border-strong text-muted hover:border-border-hover hover:text-foreground`}
      >
        ☆ Star region
      </button>
    );
  }
  if (me.isDemo) {
    return (
      <span title="Create an account to star a region" className={`${BTN} cursor-not-allowed border-border-strong text-muted opacity-60`}>
        ☆ Star region
      </span>
    );
  }
  const starred = me.region === region;
  return (
    <button
      onClick={() => void setRegion(starred ? null : region)}
      aria-pressed={starred}
      title={
        starred
          ? "Unstar — remove from your homepage"
          : me.region
            ? `Follow ${region} on your homepage instead of ${me.region}`
            : "Follow this region's top 10 on your homepage"
      }
      className={`${BTN} ${
        starred
          ? "border-gold/50 bg-gold/[0.08] text-gold hover:border-gold"
          : "border-border-strong text-muted hover:border-border-hover hover:text-foreground"
      }`}
    >
      {starred ? "★ Starred region" : "☆ Star region"}
    </button>
  );
}
