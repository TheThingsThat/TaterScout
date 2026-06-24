import Link from "next/link";
import SearchBar from "./SearchBar";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-sm font-black text-background">
            V
          </span>
          <span className="hidden text-lg font-bold tracking-tight sm:block">
            Vibe<span className="brand-gradient">Scout</span>
          </span>
        </Link>
        <div className="mx-auto w-full max-w-md">
          <SearchBar />
        </div>
        <nav className="hidden shrink-0 items-center gap-4 text-sm text-muted md:flex">
          <Link href="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <Link
            href="/rankings"
            className="hover:text-foreground transition-colors"
          >
            Rankings
          </Link>
          <Link
            href="/about"
            className="hover:text-foreground transition-colors"
          >
            About
          </Link>
        </nav>
      </div>
    </header>
  );
}
