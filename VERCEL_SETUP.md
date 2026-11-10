# Vercel setup — running TaterScout in production

Production is two deployments: **Vercel** builds and serves the Next.js app
(pages, API routes, the sync worker's compute), and **Convex** is the only
backend — it serves the season stats tables, holds the scouting app's data,
coordinates the sync worker (atomic claim), and stores the worker's state file
(raw crawl + fingerprints, gzipped) in Convex file storage. There is no blob
store and no bundled-data fallback: if Convex is unreachable, data pages render
empty until it returns.

## One-time setup

1. **Provision prod Convex** from the project root:

   ```sh
   npx convex deploy
   ```

   Then set its env vars (auth keys + the sync secret):

   ```sh
   npx @convex-dev/auth --prod --web-server-url https://<your-domain>
   npx convex env set SYNC_SECRET --prod        # paste a long random value
   npx convex env set SITE_URL https://<your-domain> --prod
   ```

2. **Vercel environment variables** (Settings → Environment Variables,
   **Production** scope):

   | Name | Value |
   | --- | --- |
   | `FIRST_API_USER` | your FIRST API username |
   | `FIRST_API_TOKEN` | your FIRST API token |
   | `NEXT_PUBLIC_CONVEX_URL` | the prod Convex deployment URL |
   | `SYNC_SECRET` | must match the value set on the Convex deployment |
   | `CRON_SECRET` | any long random string (secures `GET /api/refresh`) |

   `FIRST_API_*` power the live event/team pages (they fetch FIRST at request
   time). `NEXT_PUBLIC_CONVEX_URL` is baked into the client at build time —
   after changing it, redeploy **without** the build cache.

3. **Seed the deployment** — compute locally, then push:

   ```sh
   (
     # A subshell, so the prod URL and secret don't linger in your terminal.
     # Target prod. The secret is read from Convex, never pasted into a file.
     export NEXT_PUBLIC_CONVEX_URL="<prod url>"
     export SYNC_SECRET="$(npx convex env get SYNC_SECRET --prod)"

     # Current season (both scripts default to CURRENT_SEASON); uploads worker state
     npx tsx scripts/build-epa.ts
     npx tsx scripts/seed-convex.ts --full

     # 2025: static, dataset committed in src/data
     npx tsx scripts/seed-convex.ts 2025 --full

     # 2019-2024: static, datasets live outside git in data/seasons (build once if absent)
     for s in 2019 2020 2021 2022 2023 2024; do
       [ -f data/seasons/rankings-$s.json ] || VIBESCOUT_DATA_DIR=data/seasons npx tsx scripts/build-epa.ts $s
       VIBESCOUT_DATA_DIR=data/seasons npx tsx scripts/seed-convex.ts $s --full
     done
   )
   ```

   `--full` writes every row (required the first time; later runs diff).
   Past seasons write only their site rows; the current season's seed also
   uploads the worker state file. The worker never backfills events older than
   its 14-day sweep, so mid-season the current season must be seeded. Only a
   rollover at the very start of a season (flipping `CURRENT_SEASON` within its
   first 14 days) needs no seed: the new season starts from empty and the sweep
   picks up what's been played.

4. **Redeploy** so the env vars take effect.

## How data stays fresh

Visitors are the clock: every data-page render and every heartbeat ping
(`Heartbeat.tsx`, 60s per visible tab, served from the CDN cache for a
minute so about one ping per region reaches the function) schedules a post-response staleness
check (Next `after()`). When a sync is due, one instance wins the atomic
Convex claim, probes the active event window with If-Modified-Since (real 304s
from FIRST), recomputes, and pushes only fingerprint-changed rows. Cadence
adapts, sized to Convex's free plan: 5 min after a change (10 min Dec-Apr),
15/30/60 min as a quiet active window drags on, 60 min off-season. Rank numbers
reconcile daily. Only Vercel production auto-syncs; elsewhere use
`POST /api/refresh`.

Optionally, a scheduled trigger makes freshness traffic-independent — an
external cron (Hobby) or Vercel Cron (Pro) hitting `GET /api/refresh` with
`Authorization: Bearer <CRON_SECRET>`. Without it, a zero-visitor
stretch simply means no sync until the next page view.

## Before opening signups to the public

The app ships an in-process per-IP limiter (`src/proxy.ts`) covering `/teams/*`,
`/events/*`, `/api/search`, and `/api/scout/import`. Its state is per serverless
instance, so it blunts single-host scraping but is not a real global quota.
Two things are worth adding in the dashboard before a public launch:

1. **Vercel Firewall rate-limit rules** on those same paths, plus `/api/auth`.
   Only the edge can enforce a true cross-instance limit, and `/api/auth` is
   where credential-stuffing would land — Convex Auth's built-in limiter is
   per-account (10 failed sign-ins/hour), which does not stop one password
   sprayed across thousands of emails.
2. **Password reset is not configured.** `convex/auth.ts` uses the `Password`
   provider with no `reset` option, so a user who forgets their password is
   locked out permanently with no self-service recovery. Enabling it (and
   optional email verification) requires wiring an email provider — see
   `Password({ reset, verify })` in @convex-dev/auth.

## Notes

- **Freshness:** derived stats lag FIRST by ~1–2 min while anyone is browsing
  during an event. Event pages additionally fetch schedule/scores/ranks live
  per request and solve per-event OPR from live scores for ongoing events.
- **Cost/limits:** an incremental sync (a few changed events + recompute) is
  ~1–7s of compute. A cold full crawl (~1,500 events) should be done via the
  local `build-epa` + `seed-convex` path, never on Vercel.
- **Retired:** the Vercel Blob store and the bundled-JSON fallback are gone.
  `BLOB_*` env vars, the Blob store itself, and a `DATA_BACKEND` variable (the
  old backend toggle) can all be deleted if they still exist.
