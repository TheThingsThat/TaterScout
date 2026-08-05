// Client for the official FIRST Tech Challenge Events API
// (https://ftc-api.firstinspires.org/v2.0). HTTP Basic auth from
// FIRST_API_USER / FIRST_API_TOKEN. Server-only.
const BASE = "https://ftc-api.firstinspires.org/v2.0";

function authHeader(): string {
  const u = process.env.FIRST_API_USER;
  const t = process.env.FIRST_API_TOKEN;
  if (!u || !t) {
    throw new Error("FIRST_API_USER / FIRST_API_TOKEN not set (add them to .env.local).");
  }
  return "Basic " + btoa(`${u}:${t}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FirstOpts {
  /** Next cache seconds for live page fetches; omit for `no-store` (crawl). */
  revalidate?: number;
}

/** Percent-encode each path segment (leaving the query string alone) so an
 *  interpolated event code can't inject extra path or query segments. */
function safePath(path: string): string {
  const qIdx = path.indexOf("?");
  const p = qIdx === -1 ? path : path.slice(0, qIdx);
  const query = qIdx === -1 ? "" : path.slice(qIdx);
  return p.split("/").map(encodeURIComponent).join("/") + query;
}

/**
 * GET a FIRST API path (season included, e.g. `2025/events?eventCode=X`).
 * Returns null on 404. Retries with backoff on 429/errors; per-request timeout.
 */
export interface ConditionalResult<T> {
  notModified: boolean;
  data: T | null; // null when notModified or 404
  lastModified: string | null;
}

/**
 * Conditional GET (crawl path, no-store): sends If-Modified-Since when a token
 * is provided; a 304 comes back as `notModified` without a body. FIRST's
 * /matches endpoints honor this with real 304s (verified), which turns a no-op
 * sync into a handful of free checks.
 */
export async function firstGetConditional<T>(
  path: string,
  ifModifiedSince?: string | null,
): Promise<ConditionalResult<T>> {
  const headers: Record<string, string> = {
    Authorization: authHeader(),
    Accept: "application/json",
  };
  if (ifModifiedSince) headers["If-Modified-Since"] = ifModifiedSince;
  const init: RequestInit = { headers, cache: "no-store", signal: AbortSignal.timeout(15000) };

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}/${safePath(path)}`, init);
      if (res.status === 429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (res.status === 304) return { notModified: true, data: null, lastModified: ifModifiedSince ?? null };
      if (res.status === 404) return { notModified: false, data: null, lastModified: null };
      if (!res.ok) throw new Error(`FIRST API ${res.status} on ${path}`);
      return {
        notModified: false,
        data: (await res.json()) as T,
        lastModified: res.headers.get("last-modified"),
      };
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

export async function firstGet<T>(path: string, opts: FirstOpts = {}): Promise<T | null> {
  const init: RequestInit = {
    headers: { Authorization: authHeader(), Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  };
  if (opts.revalidate != null) (init as { next?: unknown }).next = { revalidate: opts.revalidate };
  else init.cache = "no-store";

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}/${safePath(path)}`, init);
      if (res.status === 429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`FIRST API ${res.status} on ${path}`);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}
