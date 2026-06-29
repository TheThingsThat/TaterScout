// Backend-agnostic dataset storage so the data layer works on Vercel (read-only
// filesystem) as well as locally. When BLOB_READ_WRITE_TOKEN is present (Vercel,
// or local with a token) datasets live in Vercel Blob; otherwise they're local
// files (dev / the CLI). The refresh route can therefore PERSIST on Vercel,
// which the file model couldn't.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// Bump when the raw-crawl schema changes (keeps the old cache from being reused).
const RAW_VERSION = "v6";

const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

function dataDir(): string {
  return process.env.VIBESCOUT_DATA_DIR || path.join(process.cwd(), "src", "data");
}

/** Physical local path for a dataset. Raw crawl → /tmp (+version); computed → data dir. */
function localPath(name: string): string {
  if (name.startsWith("raw-")) return `/tmp/vibescout-${name}-${RAW_VERSION}.json`;
  return path.join(dataDir(), `${name}.json`);
}

/** Blob object key for a dataset. */
function blobKey(name: string): string {
  return name.startsWith("raw-") ? `${name}-${RAW_VERSION}.json` : `${name}.json`;
}

// Resolved Blob URLs are stable (addRandomSuffix:false); cache them per instance.
const urlCache = new Map<string, string>();
async function blobUrl(name: string): Promise<string | null> {
  const key = blobKey(name);
  const cached = urlCache.get(key);
  if (cached) return cached;
  const base = process.env.BLOB_BASE_URL;
  if (base) {
    const u = `${base.replace(/\/$/, "")}/${key}`;
    urlCache.set(key, u);
    return u;
  }
  try {
    const { head } = await import("@vercel/blob");
    const h = await head(key);
    urlCache.set(key, h.url);
    return h.url;
  } catch {
    return null; // not yet written
  }
}

export async function readDataset(name: string): Promise<string | null> {
  if (useBlob()) {
    const url = await blobUrl(name);
    if (!url) return null;
    try {
      // Cache the bytes ~60s; combined with the store's in-memory TTL this bounds
      // how long after a refresh new data takes to appear.
      const res = await fetch(url, { next: { revalidate: 60 } });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }
  try {
    return readFileSync(localPath(name), "utf8");
  } catch {
    return null;
  }
}

export async function writeDataset(name: string, content: string): Promise<void> {
  if (useBlob()) {
    const { put } = await import("@vercel/blob");
    await put(blobKey(name), content, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }
  const p = localPath(name);
  if (!p.startsWith("/tmp")) mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}
