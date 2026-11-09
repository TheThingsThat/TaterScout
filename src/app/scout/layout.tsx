import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Toaster } from "sonner";
import ScoutNav from "@/components/scout/ScoutNav";
import DemoBanner from "@/components/scout/DemoBanner";

export const metadata: Metadata = { title: "TaterScout · Scouting" };

// Auth comes from the root layout's provider (one Convex client for the whole site).
export default function ScoutLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-foreground">
      <DemoBanner />
      <ScoutNav />
      <main className="mx-auto max-w-[900px] px-4 pb-20 pt-6">{children}</main>
      <Toaster theme="dark" position="top-center" richColors />
    </div>
  );
}
