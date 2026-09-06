# FareIndex

FareIndex tracks airfare inflation across a fixed basket of Indian domestic routes using a Laspeyres Price Index.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/fareindex run dev` — run the dashboard
- `PORT=4173 BASE_PATH=/ pnpm --filter @workspace/fareindex run build` — build the Netlify site
- `python main.py` — run the standalone FastAPI + SQLite version on port 8000
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required API env: `DATABASE_URL` — Postgres connection string
- Required live fare secret: `JINKO_API_KEY` — server-side Jinko API key; the daily refresh makes three searches per day
- Netlify: `netlify.toml` builds `artifacts/fareindex` and routes `/api/*` to `netlify/functions/fareindex.mjs`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Recharts
- API: Express 5 for the Replit preview, plus a standalone FastAPI adapter
- DB: PostgreSQL + Drizzle ORM for the preview, SQLite + SQLAlchemy for the standalone Python app
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/fareindex/` — responsive production dashboard with the India flight animation
- `artifacts/api-server/src/routes/fareindex.ts` — preview API and Laspeyres calculation
- `lib/api-spec/openapi.yaml` — source-of-truth API contract
- `lib/db/src/schema/fareindex.ts` — PostgreSQL tables for routes, observations, and index history
- `main.py` — portable FastAPI + SQLite implementation matching the same endpoints
- `netlify/functions/fareindex.mjs` — serverless Netlify API adapter

## Architecture decisions

- The fixed basket uses weights 0.50 / 0.35 / 0.15 and Day 1 prices as the 100.0 base period.
- The Replit preview uses managed PostgreSQL; the Python entry point keeps the requested SQLite architecture portable.
- Netlify uses a serverless function with a warm in-memory store so the static site remains deployable without a long-running process.
- Scrape runs are deliberately resilient: they always return a usable next-day observation and can be replaced with a live provider without changing the dashboard contract.

## Product

- View the daily FareIndex trend and latest movement.
- Trigger a next-day route scrape with slight market variation or a festival surge.
- Explore route-level observations, filter by route, and export Excel-compatible CSV.
- Read the fixed-basket methodology and see the animated India route context.

## User preferences

- The user requested a polished first look, an animated flight over India, Netlify deployability, and delivery to their GitHub repository.

## Gotchas

- Vite's build config requires `PORT` and `BASE_PATH`; Netlify supplies them in `netlify.toml`.
- The app contract lives in `lib/api-spec/openapi.yaml`; regenerate hooks after changing it.
- The Netlify function is intentionally stateless across cold starts; durable production history needs a hosted data store or live fare provider.
- The live provider uses Jinko's `POST /v1/flight_search` endpoint for each tracked route, requests INR one-way economy fares 30 days out, and stores the lowest returned fare. Three daily searches remain well inside Jinko's free quota.
- Netlify production must also have `JINKO_API_KEY` added in the site's environment variables; Replit Secrets are not automatically copied to Netlify. The scheduled function refreshes daily at 00:30 UTC.
- A custom JSON provider can still be used by setting `FAREINDEX_LIVE_API_URL` to an endpoint returning `{ "DEL-BOM": 5200, "BLR-DEL": 4100, "BOM-GOI": 3300 }` or an array of `{ route, fare }` records. Failed/partial feeds are reported as degraded rather than silently presented as live data.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
