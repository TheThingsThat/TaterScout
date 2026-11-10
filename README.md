# TaterScout

A FIRST Tech Challenge scouting dashboard: team EPA and OPR, win predictions,
strength of schedule, event rankings and match results, plus a scouting app for
teams to collect their own match and pit reports.

Next.js (App Router) on Vercel, with [Convex](https://convex.dev) as the only
backend: season stats, scouting data, sign-in and the sync worker's state.

## Local development

```sh
npm install
npx convex dev   # dev Convex deployment; writes NEXT_PUBLIC_CONVEX_URL to .env.local
npm run dev      # http://localhost:3000
```

Live event and team pages also need `FIRST_API_USER` and `FIRST_API_TOKEN` in
`.env.local`.

Every season-stats read (rankings, team, event and search pages) and the sync
itself need a shared `SYNC_SECRET`, set on the dev Convex deployment and in
`.env.local`; without it those pages render as if Convex were down. Then seed:

```sh
s="$(openssl rand -hex 32)"
npx convex env set SYNC_SECRET "$s"     # dev deployment
echo "SYNC_SECRET=$s" >> .env.local
npx tsx scripts/build-epa.ts && npx tsx scripts/seed-convex.ts --full   # current season
```

## Production

See [VERCEL_SETUP.md](VERCEL_SETUP.md) for provisioning, environment variables,
seeding every season, and how data stays fresh.
