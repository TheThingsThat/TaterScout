/** A same-site path to return to after sign-in. Anything that could resolve to
 *  another origin, or to the sign-in page itself, goes home. Parsed rather than
 *  prefix-checked: URL parsing strips tabs and newlines and reads "\\" as "/", so
 *  "/<tab>/evil.com" would otherwise slip through as "//evil.com". */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/")) return "/";
  let u: URL;
  try {
    u = new URL(raw, "http://n");
  } catch {
    return "/";
  }
  if (u.origin !== "http://n") return "/";
  if (u.pathname === "/sign-in" || u.pathname.startsWith("/sign-in/")) return "/";
  return u.pathname + u.search + u.hash;
}
