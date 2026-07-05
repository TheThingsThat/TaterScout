# Vercel setup — running TaterScout in production

Two things production needs: **FIRST API credentials** (live team/event pages
call the FIRST API at request time) and a **Vercel Blob store** (the read-only
serverless filesystem can't persist a refresh, so datasets live in Blob).

The data layer (`src/lib/data/storage.ts`) is backend-agnostic:

- **Local dev / CLI** (no `BLOB_READ_WRITE_TOKEN`): datasets are JSON files
  (`src/data/*.json` + `/tmp/vibescout-raw-*.json`). Works out of the box.
- **Vercel** (read-only filesystem): when `BLOB_READ_WRITE_TOKEN` is present,
  datasets live in **Vercel Blob**, so the refresh route can persist and the app
  reads the fresh data. Without this, the refresh button is a no-op on Vercel and
  the trajectory/rankings stay frozen at the last deploy.

## One-time setup

1. **Add the FIRST API credentials** (REQUIRED). Vercel dashboard → your project →
   **Settings** → **Environment Variables** → add both, for **Production** (and
   Preview if you use it):

   | Name | Value |
   | --- | --- |
   | `FIRST_API_USER` | your FIRST API username |
   | `FIRST_API_TOKEN` | your FIRST API token |

   Same values as your local `.env.local`. Without them, event and team pages
   throw at request time (they fetch from FIRST live).

2. **Create a Blob store**: Vercel dashboard → your project → **Storage** →
   **Create** → **Blob** (access **Public**) → connect it to the project. This
   auto-injects `BLOB_READ_WRITE_TOKEN` into the deployment (Production + Preview).

3. **(Optional) `BLOB_BASE_URL`**: set it to the store's public base
   (`https://<store-id>.public.blob.vercel-storage.com`) to skip a per-read
   `head()` lookup. If omitted, the app resolves blob URLs automatically.

4. **Seed the store** — upload your current local datasets to Blob (instant, no
   crawl). Copy the token from the Blob store's settings and run from the project
   root:

   ```sh
   BLOB_READ_WRITE_TOKEN="<token from the Vercel store>" \
     npx tsx scripts/seed-blob.ts 2025
   ```

   Uploads the four current datasets (`rankings`, `trajectories`, `event-stats`,
   and the latest `raw-2025-v*` cache — the script auto-detects the version).
   Re-run any time you regenerate data locally so Blob overwrites the old copy.
   (Or, for a fresh crawl instead of uploading, run `build-epa.ts 2025 --refetch`
   with the FIRST + Blob env vars set — slower, one-time.)

5. **Redeploy.** The app now reads datasets from Blob, and the **refresh button**
   (or a future cron) writes to Blob → trajectory, rankings, EPA and event-stats
   update live in production.

## Notes

- **Freshness:** reads are cached ~60s (HTTP cache + an in-memory TTL), so after a
  refresh new data appears within ~60s across serverless instances.
- **Cost/limits:** an *incremental* refresh (a few changed events + recompute) is
  ~1–2s of compute and fits the function limit. A *cold full crawl* (~1,500 events)
  should be done via the local `build-epa` seed, not the button.
- **Auto-updates without the button:** add a **Vercel Cron** (Pro plan; Hobby is
  daily-only) hitting `POST /api/refresh` every minute — same logic, runs itself.
