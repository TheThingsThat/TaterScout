import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Toaster } from "sonner";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import ConvexClientProvider from "@/components/scout/ConvexClientProvider";
import ScoutNav from "@/components/scout/ScoutNav";

export const metadata: Metadata = { title: "TaterScout · Scouting" };

export default function ScoutLayout({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsServerProvider>
      <ConvexClientProvider>
        <div className="min-h-screen bg-black text-foreground">
          <ScoutNav />
          <main className="mx-auto max-w-[900px] px-4 pb-20 pt-6">{children}</main>
          <Toaster theme="dark" position="top-center" richColors />
        </div>
      </ConvexClientProvider>
    </ConvexAuthNextjsServerProvider>
  );
}
