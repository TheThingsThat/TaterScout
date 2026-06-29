# Vercel setup — making the refresh button work in production

The data layer (`src/lib/data/storage.ts`) is backend-agnostic:

- **Local dev / CLI** (no `BLOB_READ_WRITE_TOKEN`): datasets are JSON files
  (`src/data/*.json` + `/tmp/vibescout-raw-*.json`). Works out of the box.
- **Vercel** (read-only filesystem): when `BLOB_READ_WRITE_TOKEN` is present,
  datasets live in **Vercel Blob**, so the refresh route can persist and the app
  reads the fresh data. Without this, the refresh button is a no-op on Vercel and
  the trajectory/rankings stay frozen at the last deploy.

## One-time setup

1. **Create a Blob store**: Vercel dashboard → your project → **Storage** →
   **Create** → **Blob** → connect it to the project. This auto-injects
   `BLOB_READ_WRITE_TOKEN` into the deployment's environment (Production + Preview).

2. **(Optional) `BLOB_BASE_URL`**: set it to the store's public base
   (`https://<store-id>.public.blob.vercel-storage.com`) to skip a per-read
   `head()` lookup. If omitted, the app resolves blob URLs automatically.

3. **Seed the store** — upload your current local datasets to Blob (instant, no
   crawl). Copy the token from the Blob store's settings and run:

   ```sh
   BLOB_READ_WRITE_TOKEN="<token from the Vercel store>" \
     npx tsx scripts/seed-blob.ts 2025
   ```

   (Or, for a fresh crawl instead of uploading local data, run
   `scripts/build-epa.ts 2025` with the same token — slower, one-time.)

4. **Redeploy.** The app now reads datasets from Blob, and the **refresh button**
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
