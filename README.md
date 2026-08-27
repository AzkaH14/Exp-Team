# Mohsyn Dashboard

Operations dashboard for Mohsyn client utilization, QoL scoring, engagement intelligence, and ticket management.

**Deployment repo:** This folder is a **standalone git repository**, separate from the architecture docs in `bmashrequi/Mohsin`.

| | |
|---|---|
| **GitHub (create & push here)** | `https://github.com/bmashrequi/mohsyn-dashboard` |
| **Vercel** | Import the GitHub repo above — root directory is `/` (this repo) |
| **Architecture docs** | Stay in [bmashrequi/Mohsin](https://github.com/bmashrequi/Mohsin) (`architecture/` only) |

## GitHub setup (one-time)

From this `dashboard/` folder:

```bash
# 1. Create an empty repo on GitHub named: mohsyn-dashboard
#    https://github.com/new  (do NOT add README — we already have one)

# 2. Link and push
git remote add origin https://github.com/bmashrequi/mohsyn-dashboard.git
git commit -m "Initial commit: Mohsyn operations dashboard"
git push -u origin main
```

All future dashboard work: commit and push **here**, not in the parent `Mohsin` repo.

## Vercel deployment

1. Go to [vercel.com/new](https://vercel.com/new) → **Import Git Repository**
2. Select `bmashrequi/mohsyn-dashboard`
3. Framework preset: **Next.js** (auto-detected)
4. Root directory: **`.`** (repo root)
5. Add environment variables from `.env.example` (at minimum `HUBSPOT_ACCESS_TOKEN`)
6. Deploy — every push to `main` triggers a new deployment

### Vercel (Hobby plan)

Page loads use **bundled static data** (`src/data/*.json`) so the site stays under serverless time limits. HubSpot live sync is **manual only** on Vercel — use the **Sync** button (calls `POST /api/sync/hubspot`). Full ticket + notes sync can exceed Hobby timeouts; run heavy syncs locally and commit updated JSON, or upgrade Vercel for longer function duration.

Required Vercel env vars: copy from `.env.example`. You do **not** need `HUBSPOT_ACCESS_TOKEN` for the dashboard to load — only for live sync from the UI.

## Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Recharts
- lucide-react

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Data sync

Sync report data from the client utilization dashboard:

```bash
python3 scripts/sync-report-data.py
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run dev:clean` | Clear `.next` cache and start dev |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |

## HubSpot live sync

1. Copy `.env.example` → `.env.local` and set `HUBSPOT_ACCESS_TOKEN`
2. Restart dev server: `npm run dev`
3. **First page load** fetches HubSpot once and precomputes all metrics (QoL, clients, engagement)
4. **Tab navigation** reads from in-memory session cache — no HubSpot calls
5. Click **Sync** → `POST /api/sync/hubspot` to force a fresh HubSpot fetch

After updating, hard-refresh the browser once (`Cmd+Shift+R`) to clear old cached JS.

Without a token, the dashboard falls back to static `src/data/*.json`.

## Architecture

- `src/lib/integrations/hubspot-sync.ts` — fetch + map HubSpot tickets
- `src/lib/data-source.ts` — session cache + `warmSession()` (HubSpot once per session)
- `src/lib/session-metrics.ts` — precomputed QoL, client list, profiles, urgent clients
- `src/lib/data-provider.ts` — dashboard snapshot from cache
- `/api/sync/hubspot` — manual force refresh from HubSpot
- `/api/engagement`, `/api/tickets` — read session cache only (pagination/filtering)
