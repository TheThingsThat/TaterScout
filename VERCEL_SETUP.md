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

1. **Add the environment variables.** Vercel dashboard → your project →
   **Settings** → **Environment Variables** → add these, for **Production** (and
   Preview if you use it):

   | Name | Value |
   | --- | --- |
   | `FIRST_API_USER` | your FIRST API username |
   | `FIRST_API_TOKEN` | your FIRST API token |
   | `CRON_SECRET` | any long random string (secures the scheduled-sync endpoint) |

   `FIRST_API_*` are the same values as your local `.env.local`; without them,
   event and team pages throw at request time (they fetch from FIRST live).
   `CRON_SECRET` is sent by Vercel Cron as `Authorization: Bearer <CRON_SECRET>`
   and required by `GET /api/refresh` (see step 5).

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

5. **Enable scheduled live updates** — a minute-cadence trigger for
   `GET /api/refresh` (which sends `Authorization: Bearer $CRON_SECRET`):

   - **Hobby plan (recommended for this project): use an external trigger** — e.g.
     [cron-job.org](https://cron-job.org) (free, true 1-minute). Create a job:
     method **GET**, URL `https://<your-domain>/api/refresh`, schedule **every 1
     minute**, and add a header `Authorization: Bearer <CRON_SECRET>`. (Do **not**
     put an every-minute cron in `vercel.json` on Hobby — Vercel rejects the
     deploy with "Hobby accounts are limited to daily cron jobs.")
   - **Pro plan: use Vercel's native cron** — add a `vercel.json`:

     ```json
     { "crons": [{ "path": "/api/refresh", "schedule": "* * * * *" }] }
     ```

     Vercel runs it every minute; no third party needed.

6. **Redeploy.** The app now reads datasets from Blob, the scheduled trigger keeps
   them current during events, and the ↻ button forces an immediate full sweep.

## How data stays fresh

Primary path is a **scheduled sync** — Vercel Cron (Pro) or an external trigger
(Hobby) calls `GET /api/refresh` every minute, so freshness does **not** depend
on traffic. Emulating ftc-scout: the frequent sync scopes to **ongoing events
only** (`start ≤ now ≤ end`), pulls their matches/scores from FIRST, and — only
if something changed — recomputes EPA/OPR/sim-model/trajectories/world-record/
search-index and persists to Blob. A wider ±14/+3-day sweep runs at most every
30 min to catch late score corrections. Open event/team pages poll every ~30s
(`LiveRefresh`) to surface new data (serverless can't push over WebSockets).

A traffic-driven check (`src/lib/data/autoRefresh.ts`, Next `after()`) remains as
a **fallback** for when the cron is off (e.g. before it's configured); its cadence
adapts 60s/120s/30min by activity. A `meta-<season>.json` dataset coordinates
instances (best-effort lock; a rare race just re-runs an idempotent sync). The
header ↻ button uses the same runner and forces a full sweep.

## Notes

- **Freshness:** derived data is at most ~1–2 min behind FIRST while anyone is
  browsing during an event (dataset reads are cached ~60s per instance on top of
  the sync cadence). Event pages additionally fetch schedule/scores/ranks live
  per request, and solve per-event OPR from live scores for ongoing events.
- **Traffic independence:** with the scheduled sync configured (step 5), data
  advances during events even with zero visitors. If you skip it, freshness falls
  back to traffic-driven and a zero-visitor stretch means no sync until the next
  page view (which still serves current-store data instantly).
- **Cost/limits:** an *incremental* sync (a few changed events + recompute) is
  ~1–7s of compute and fits the function limit. A *cold full crawl* (~1,500
  events) should be done via the local `build-epa` seed, not the button.
