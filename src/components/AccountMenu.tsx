"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { signInHref, useEndDemo, useMe } from "./useMe";

const ITEM =
  "block w-full rounded-lg px-3 py-2 text-left text-[13px] text-body no-underline transition-colors hover:bg-surface-2 hover:text-foreground";
const PILL_W = "w-[72px]";

/** Top-right of the site header: "Sign in", or the signed-in visitor's menu. */
export default function AccountMenu() {
  const me = useMe();
  const path = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const endDemo = useEndDemo();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Navigating (including Back) closes the menu: adjusted during render, not in an effect.
  const [shownOn, setShownOn] = useState(path);
  if (shownOn !== path) {
    setShownOn(path);
    setOpen(false);
  }

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Only a visitor with a token loads (useMe), so this is the avatar's footprint
  // and the header doesn't shift.
  if (me === undefined) return <div aria-hidden className="h-8 w-8 shrink-0 rounded-full bg-surface-2" />;

  if (me === null) {
    if (path === "/sign-in") return <div aria-hidden className={`h-8 ${PILL_W} shrink-0`} />;
    return (
      <button
        onClick={() => router.push(signInHref())}
        className={`h-8 ${PILL_W} shrink-0 whitespace-nowrap rounded-full border border-border-strong text-center text-[13px] text-foreground transition-colors hover:border-border-hover`}
      >
        Sign in
      </button>
    );
  }

  /** Sign out (ending the demo first for demo users), then go to `then` if given. */
  async function leave(then?: string) {
    setBusy(true);
    try {
      if (me?.isDemo) {
        if (!(await endDemo())) return;
      } else {
        await signOut();
      }
      setOpen(false);
      if (then) router.push(then);
      // /scout requires sign-in; everywhere else stays put.
      else if (path?.startsWith("/scout")) router.replace("/");
    } finally {
      setBusy(false);
    }
  }

  const label = me.isDemo ? "Demo" : (me.name ?? me.email ?? "Account");
  const initial = me.isDemo ? "D" : (label.trim()[0] ?? "?").toUpperCase();
  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${label}`}
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border-strong bg-surface-2 text-[13px] font-semibold text-foreground transition-colors hover:border-border-hover"
        style={me.isDemo ? { borderColor: "color-mix(in srgb, var(--gold) 50%, transparent)", color: "var(--gold)" } : undefined}
      >
        {me.image && !me.isDemo ? (
          // Google profile photos come from a host we don't proxy; a plain img is fine here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[240px] rounded-xl border border-border-strong bg-input p-1.5 shadow-[0_12px_40px_var(--shadow)]"
        >
          <div className="border-b border-border px-3 pb-2.5 pt-2">
            {me.isDemo ? (
              <>
                <div className="text-[13px] font-medium text-gold">Demo session</div>
                <div className="mt-0.5 text-[12px] text-dim">
                  Throwaway data. Create an account to star teams.
                </div>
              </>
            ) : (
              <>
                <div className="truncate text-[13px] font-medium text-foreground">{label}</div>
                {me.name && me.email && <div className="truncate text-[12px] text-dim">{me.email}</div>}
              </>
            )}
          </div>
          <div className="pt-1.5">
            {!me.isDemo && (
              <Link href="/" role="menuitem" className={ITEM} onClick={close}>
                Starred teams <span className="text-dim">({me.teams.length})</span>
              </Link>
            )}
            <Link href="/scout" role="menuitem" className={ITEM} onClick={close}>
              {me.isDemo ? "Back to the demo" : "Scouting workspaces"}
            </Link>
            {me.isDemo && (
              <button
                role="menuitem"
                disabled={busy}
                onClick={() => void leave(signInHref())}
                className={`${ITEM} disabled:opacity-60`}
              >
                Create an account
              </button>
            )}
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => void leave()}
              className={`${ITEM} disabled:opacity-60`}
            >
              {me.isDemo ? "End demo" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
