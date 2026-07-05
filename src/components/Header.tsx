import Link from "next/link";
import SearchBar from "./SearchBar";
import NavLinks from "./NavLinks";
import RefreshButton from "./RefreshButton";
import { ensureLoaded } from "@/lib/data/store";
import { getLastUpdated } from "@/lib/rankings";
import { CURRENT_SEASON } from "@/lib/season";

export default async function Header() {
  await ensureLoaded(CURRENT_SEASON); // so the "updated" stamp is available on cold instances
  const lastUpdated = getLastUpdated(CURRENT_SEASON);
  return (
    <header className="sticky top-0 z-[60] border-b border-[#161616] bg-black/70 backdrop-blur-[14px]">
      <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-5 py-[18px] sm:gap-6 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center">
          <span className="font-mono text-[15px] font-bold tracking-[0.24em] text-foreground sm:text-[16px] sm:tracking-[0.28em]">
            TaterScout
          </span>
        </Link>
        <div className="mx-auto w-full max-w-[420px]">
          <SearchBar />
        </div>
        <NavLinks />
        <RefreshButton lastUpdated={lastUpdated} />
      </div>
    </header>
  );
}
