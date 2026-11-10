"use client";

import { useSyncExternalStore } from "react";
import { THEME_COOKIE } from "@/lib/theme";

type Theme = "light" | "dark";

/** The theme on screen: the chosen one (data-theme), else the device's. */
function current(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
}

/** The theme on screen, or null during server render / hydration. */
export function useTheme(): Theme | null {
  return useSyncExternalStore(subscribe, current, () => null);
}

/** Header button: switch between light and dark. The choice is kept for a year in
 *  a cookie, so the server renders it next time; until then the device decides. */
export default function ThemeToggle() {
  // Unknown on the server (it can't see the device setting): render a neutral slot.
  const theme = useTheme();

  function toggle() {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    listeners.forEach((l) => l());
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      title={theme === "light" ? "Dark theme" : "Light theme"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-strong text-muted transition-colors hover:border-border-hover hover:text-foreground"
    >
      {theme === null ? null : theme === "light" ? (
        // Moon: go dark
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        // Sun: go light
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
