import Link from "next/link";
import SearchBar from "./SearchBar";
import NavLinks from "./NavLinks";

export default function Header() {
  return (
    <header className="sticky top-0 z-[60] border-b border-[#161616] bg-black/70 backdrop-blur-[14px]">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-3 px-5 py-[18px] sm:gap-x-6 sm:px-8 min-[860px]:flex-nowrap">
        <Link href="/" className="flex shrink-0 items-center">
          <span className="font-mono text-[15px] font-bold tracking-[0.24em] text-foreground sm:text-[16px] sm:tracking-[0.28em]">
            TaterScout
          </span>
        </Link>
        <div className="min-w-0 flex-1 min-[860px]:mx-auto min-[860px]:w-full min-[860px]:max-w-[420px] min-[860px]:flex-initial">
          <SearchBar />
        </div>
        <NavLinks />
      </div>
    </header>
  );
}
