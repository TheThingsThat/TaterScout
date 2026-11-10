"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/components/ThemeToggle";

/** The scouting app's toasts, in the site's current theme. */
export default function Toasts() {
  return <Toaster theme={useTheme() ?? "dark"} position="top-center" richColors />;
}
