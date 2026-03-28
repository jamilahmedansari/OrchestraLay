# Deployment & Configuration

> **Status:** Implemented. Dockerfile, railway.toml, and .env.example are in place. Remaining: Stripe env vars (step 30).

---

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (e.g., `https://xxxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Supabase public anon key — safe for frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key — **server only, never expose to frontend** |
| `DATABASE_URL` | PostgreSQL connection string from the same Supabase project |
| `ANTHROPIC_API_KEY` | Claude API access |
| `OPENAI_API_KEY` | GPT-4o / GPT-4o-mini API access |
| `PERPLEXITY_API_KEY` | Perplexity API access |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist (e.g., `http://localhost:5173,https://app.orchestralay.com`) |

### Optional

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | `development` or `production` |
| `N8N_WEBHOOK_URL` | — | n8n webhook base URL for outbound notifications |
| `N8N_WEBHOOK_SECRET` | — | HMAC signing secret for n8n webhooks |
| `STRIPE_SECRET_KEY` | — | Stripe billing (phase 2) |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signature verification |

---

## Local Development

```bash
# 1. Clone and install
git clone https://github.com/your-org/orchestralay
cd orchestralay
npm install

# 2. Configure environment
cp .env.example .env
# Fill in all required variables

# 3. Run database migrations
npm run db:migrate

# 4. Start development
npm run dev
```

This starts both:
- **Server** at `http://localhost:3001` (Express + tRPC + pg-boss worker)
- **Dashboard** at `http://localhost:5173` (Vite dev server with HMR)

### Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start server with tsx watch (auto-reload on changes) |
| `npm run dev:frontend` | Start Vite dev server only (port 5173) |
| `npm run build` | Compile TypeScript + build Vite frontend |
| `npm run start` | Run production server (`node dist/server/index.js`) |
| `npm run db:generate` | Generate Drizzle migration files |
| `npm run db:migrate` | Run pending migrations |
| `npm run db:push` | Push schema directly (dev only) |
| `npm run db:studio` | Open Drizzle Studio (database browser) |

**Note:** Run `npm run dev` and `npm run dev:frontend` in separate terminals for full-stack development. The Vite dev server proxies `/trpc` requests to `http://localhost:3001`.

---

## Supabase Project Setup

OrchestraLay requires its own Supabase project (do not share with other applications).

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to Settings > API to find `SUPABASE_URL` and `SUPABASE_ANON_KEY`
3. Go to Settings > API > Service Role to find `SUPABASE_SERVICE_ROLE_KEY`
4. Go to Settings > Database to find `DATABASE_URL` (use the connection string, not the pooler for migrations)
5. Enable Realtime on the `tasks` table (used for live dashboard updates)

---

## Railway Deployment

OrchestraLay deploys as a **single service** on Railway — server and worker run in the same Node.js process.

### Dockerfile

Multi-stage build (3 stages, Node 20-slim base):

1. **base** — Install production dependencies only (`npm ci --omit=dev`)
2. **build** — Install all dependencies, copy source, run `npm run build` (produces `dist/server/` and `dist/client/`)
3. **production** — Copy `node_modules` from base, `dist/server` and `dist/client` from build, expose port 3001, run `node dist/server/index.js`

The frontend is served as static files from Express in production (both from the same container).

### railway.toml

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### Environment variables on Railway

Set all required environment variables in the Railway service settings. The `PORT` variable is automatically set by Railway.

---

## Startup Order

The server **must** start in this exact sequence:

```
1. getQueue()                    ← Initialize pg-boss (connects to PostgreSQL)
2. startOrchestrationWorker()    ← Register job handler
3. app.listen(PORT)              ← Accept HTTP requests
```

**Why this order matters:**
- Queue before worker: Worker registration requires an active queue connection
- Worker before server: If the server accepts tasks before the worker is ready, tasks are enqueued but never processed
- This was originally Bug 3 in CLAUDE.md — now fixed in `server/index.ts`

---

## n8n Integration (Optional)

n8n handles outbound notifications only. The product works fully without it.

If `N8N_WEBHOOK_URL` is set, these events fire as POST requests with a 3-second timeout:

| Event | Purpose |
|---|---|
| `task.completed` | Customer webhooks, Slack notifications, Linear/GitHub comments |
| `task.failed` | Failure alerts to project owner |
| `diff.flagged` | Safety alerts to team admin |
| `cost.threshold_exceeded` | Billing alert emails |

If the webhook fails or times out, it's silently ignored. n8n is never in the request/response path.

---

## CORS

`ALLOWED_ORIGINS` is a comma-separated list of allowed origins. In development:
```
ALLOWED_ORIGINS=http://localhost:5173
```

Never use `*` as the CORS origin when credentials (cookies/auth headers) are in use.

---

## Health Check

The server exposes a health endpoint for Railway's healthcheck:
```
GET /health → { "status": "ok", "timestamp": "2026-03-28T..." }
```
