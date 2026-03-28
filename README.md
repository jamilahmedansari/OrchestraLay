# OrchestraLay

Route AI tasks to Claude, GPT-4o, or Perplexity. See exactly what each call costs. Approve every code change before it touches your files.

---

## The problem it solves

AI coding agents on Replit and Vercel are unpredictable — they burn through budgets without warning and make breaking changes you only discover after the damage is done. OrchestraLay puts you in control:

- Routes each task to the best available model based on cost, health, and task type
- Shows the cost down to fractions of a cent per model call
- Requires your explicit approval on every file change before anything is written to disk
- Falls back to the next model automatically if one fails or times out

---

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/your-org/orchestralay
cd orchestralay
npm install

# 2. Configure environment
cp .env.example .env
# Required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#           DATABASE_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY, PERPLEXITY_API_KEY

# 3. Run migrations
npm run db:migrate

# 4. Start dev server
npm run dev
# → API:       http://localhost:3001
# → Dashboard: http://localhost:5173
```

Sign up at `http://localhost:5173` → copy your API key from the dashboard.

---

## CLI

```bash
# Install
npm install -g @orchestralay/cli

# Submit a task
ORCHESTRALAY_API_KEY=olay_xxx orchestralay submit \
  --prompt "Refactor this function to use async/await and proper error handling" \
  --type refactoring

# Check status
orchestralay status --task-id task_a3f9xx

# Apply approved diffs to disk
orchestralay apply --task-id task_a3f9xx

# Preview without writing
orchestralay apply --task-id task_a3f9xx --dry-run

# Revert applied changes
orchestralay apply --task-id task_a3f9xx --revert
```

Tasks stream status in real time: `submitted → routing → executing → completed`

---

## Dashboard

Three views at `http://localhost:5173`:

**Overview** — live task feed showing task ID, prompt, model used, status, cost, and age. Updates in real time via Supabase Realtime.

**Costs** — 7-day spend breakdown by model, month-to-date total against your plan budget, exact token and cost figures per model.

**Diff review** — every pending file change across your projects. Flagged diffs show why. Blocked diffs require changing project safety settings before they can be applied.

---

## How routing works

Each task runs through 6 gates in order:

1. **Preference** — use your `--model` flag if provided, otherwise use the default ranking for the task type
2. **Budget** — filter out models that would exceed your budget cap
3. **Health** — skip models with too many recent failures (circuit breaker)
4. **Concurrency** — skip models at their concurrent request limit
5. **Select** — first remaining candidate wins
6. **Fallback** — if the selected model fails mid-execution, automatically retry with the next

The routing decision (which model was chosen and why) is stored with every task and visible in the dashboard.

---

## Supported models

| Model | Best for | Input / Output per 1M tokens |
|---|---|---|
| claude-3-5-sonnet | Code generation, refactoring, review | $3.00 / $15.00 |
| gpt-4o | Analysis, debugging, review | $2.50 / $10.00 |
| perplexity-sonar-pro | Web-grounded analysis | $3.00 / $15.00 |
| claude-3-haiku | Fast debugging, low-cost tasks | $0.25 / $1.25 |
| gpt-4o-mini | Budget analysis | $0.15 / $0.60 |
| perplexity-sonar | Budget analysis | $0.80 / $0.80 |

---

## Safety rules

OrchestraLay blocks diffs that attempt to:

- Modify `.env` files or lockfiles
- Delete files _(configurable per project)_
- Change framework config files (`package.json`, `tsconfig.json`, `vite.config.*`)
- Delete test files
- Introduce hardcoded secrets, API keys, or credentials
- Match paths on your custom blocklist

Flagged diffs show a warning but can still be approved. Blocked diffs cannot be approved via the API — they require a human to review and update project safety settings first.

---

## Pricing

| Plan | Price | Tokens / month | Team seats |
|---|---|---|---|
| Starter | $29/mo | 500k | 1 |
| Pro | $99/mo | 2M | 5 |
| Enterprise | Custom | Unlimited | Unlimited |

7-day free trial. Overage charged at $0.002 per 1k tokens — no hard blocks.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only admin key |
| `DATABASE_URL` | Yes | Postgres connection string |
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `OPENAI_API_KEY` | Yes | GPT-4o access |
| `PERPLEXITY_API_KEY` | Yes | Perplexity access |
| `ALLOWED_ORIGINS` | Yes | Comma-separated CORS allowlist |
| `N8N_WEBHOOK_URL` | No | n8n webhook base URL for notifications |
| `STRIPE_SECRET_KEY` | No | Required for billing |
| `PORT` | No | Default 3001 |

See `.env.example` for the full list with descriptions.

---

## Tech stack

Node 20 · Express · tRPC · Drizzle ORM · Supabase PostgreSQL · pg-boss · Vite · React 19 · Wouter · TailwindCSS · Railway

---

## Architecture

For complete architecture documentation — data flow, layer boundaries, routing logic, database schema, and all design decisions — see [AGENTS.md](./AGENTS.md).

For Claude Code and AI agent coding rules — build order, known bugs, conventions, and hard prohibitions — see [CLAUDE.md](./CLAUDE.md).

---

## License

MIT
