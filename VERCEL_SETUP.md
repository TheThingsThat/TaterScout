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
   npx tsx scripts/build-epa.ts 2025
   NEXT_PUBLIC_CONVEX_URL="<prod url>" SYNC_SECRET="<prod secret>" \
     npx tsx scripts/seed-convex.ts 2025 --full
   ```

   `--full` writes every row (required the first time; later runs diff).
   The seed also uploads the worker state file, which is what lets the
   deployment's own sync worker start syncing.

4. **Redeploy** so the env vars take effect.

## How data stays fresh

Visitors are the clock: every data-page render and every heartbeat ping
(`Heartbeat.tsx`, 60s per visible tab) schedules a post-response staleness
check (Next `after()`). When a sync is due, one instance wins the atomic
Convex claim, probes the active event window with If-Modified-Since (real 304s
from FIRST), recomputes, and pushes only fingerprint-changed rows. Cadence
adapts: 60s while results are flowing, 120s during a quiet active window,
30 min off-season.

Optionally, a scheduled trigger makes freshness traffic-independent — an
external cron (Hobby) or Vercel Cron (Pro) hitting `GET /api/refresh` with
`Authorization: Bearer <CRON_SECRET>` every minute. Without it, a zero-visitor
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
