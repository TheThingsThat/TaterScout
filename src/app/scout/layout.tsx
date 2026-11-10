import type { ReactNode } from "react";
import type { Metadata } from "next";
import ScoutNav from "@/components/scout/ScoutNav";
import DemoBanner from "@/components/scout/DemoBanner";
import Toasts from "@/components/scout/Toasts";

export const metadata: Metadata = { title: "TaterScout · Scouting" };

// Auth comes from the root layout's provider (one Convex client for the whole site).
export default function ScoutLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBanner />
      <ScoutNav />
      <main className="mx-auto max-w-[900px] px-4 pb-20 pt-6">{children}</main>
      <Toasts />
    </div>
  );
}
