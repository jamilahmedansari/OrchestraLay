# CLAUDE.md

> Read this file before touching any other file in this project.

---

## What this is

OrchestraLay is a multi-model AI orchestration SaaS. It accepts developer tasks via API or CLI, routes them to the best available AI provider (Claude, GPT-4o, or Perplexity) using a 6-gate decision engine, runs every code change through a diff preview safety layer requiring explicit approval, and tracks costs in real time per model call. The dashboard shows exactly what each task cost and which model ran it.

---

## Stack — non-negotiable, do not substitute

| Layer | Technology | Rule |
|---|---|---|
| Backend | Node 20, Express | Do not use Next.js, Fastify, or Hono |
| API | tRPC + superjson | Do not use REST endpoints for business logic |
| ORM | Drizzle ORM | Never write raw SQL except the atomic spend increment |
| Database | Supabase PostgreSQL | New project — not TTML's dpvrovxcxwspgbbvysil |
| Queue | pg-boss | No Redis, no BullMQ, no SQS |
| Frontend | Vite + React 19 + Wouter + TailwindCSS | No Next.js, no React Router |
| Deployment | Railway via Dockerfile | Single service — server + worker in same process |
| Auth | Supabase Auth (JWT) + SHA-256 API keys | Two surfaces, one context resolver |

---

## Build order — complete each file fully before moving to the next

```
1.  server/db/schema.ts              <- everything imports this first
2.  server/db/index.ts               <- Drizzle client
3.  server/lib/supabase.ts           <- admin + anon clients
4.  server/lib/hashKey.ts            <- generateApiKey / hashApiKey
5.  server/lib/tokenizer.ts          <- estimateTokens (Math.ceil(len/4))
6.  server/lib/queue.ts              <- pg-boss singleton
7.  server/trpc/trpc.ts              <- tRPC instance + error formatter
8.  server/trpc/context.ts           <- JWT + API key context resolution
9.  server/trpc/guards.ts            <- middleware + procedure variants
10. server/lib/modelRegistry.ts      <- 6 models, pricing, rankings
11. server/lib/modelHealth.ts        <- in-memory circuit breaker
12. server/lib/modelRouter.ts        <- resolveModel() + resolveFailover()
13. server/lib/modelCallers.ts       <- callModel() for all 3 providers
14. server/lib/outputParser.ts       <- <file_changes> XML parser
15. server/lib/diffComputer.ts       <- unified diff via 'diff' package
16. server/lib/safetyRules.ts        <- 8 safety checks
17. server/lib/diffEngine.ts         <- parse -> diff -> safety -> persist
18. server/lib/budgetGuard.ts        <- pre-flight spend enforcement
19. server/lib/rateLimiter.ts        <- per-API-key bucket rate limiting
20. server/lib/realtime.ts           <- broadcastTaskUpdate()
21. server/lib/eventEmitter.ts       <- fire-and-forget n8n POST
22. server/lib/audit.ts              <- writeAuditLog()
23. server/workers/orchestrateTask.ts<- pg-boss consumer
24. server/routers/*.ts              <- tasks, diffs, dashboard, auth, index
25. server/index.ts                  <- wire everything + startup order
26. [verify] curl POST /trpc/tasks.submit reaches completed status
27. src/                             <- Vite React frontend
28. cli/index.ts                     <- submit / status / apply
29. Dockerfile + railway.toml
30. Stripe checkout + webhook
```

---

## Known bugs — fix these before the code would be called

### Bug 1 — req scope in resolveJwt
`resolveJwt` references `req.query.teamId` but `req` is not in scope as a standalone function.

**Fix:** Change signature to `resolveJwt(token: string, req: Request)` and pass `req` explicitly from `resolveAuth(req: Request)`.

### Bug 2 — estimateTokens never implemented
`orchestrateTask.ts` calls `estimateTokens(prompt)` before `resolveModel()`. If the file is missing, the worker crashes on every task.

**Fix:** Create `server/lib/tokenizer.ts`:
```typescript
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
```

### Bug 3 — worker never started
Without calling `startOrchestrationWorker()` in `server/index.ts`, all tasks stay at `status: 'submitted'` forever.

**Fix:** In `server/index.ts`, startup order must be:
```typescript
await getQueue()                    // 1. queue first
await startOrchestrationWorker()    // 2. worker second
app.listen(PORT, ...)               // 3. server last
```

### Bug 4 — missing imports in tasks.ts
`routers/tasks.ts` uses `projects` (from `../db/schema`) and `count` (from `drizzle-orm`) but both are missing from imports.

**Fix:** Add to top of `tasks.ts`:
```typescript
import { tasks, projects, modelResults, diffs, costLogs } from '../db/schema'
import { eq, and, desc, inArray, count, gte, sql } from 'drizzle-orm'
```

---

## Coding conventions

- **ORM only** — use Drizzle for all queries. One exception: the atomic team spend update must be raw SQL: `UPDATE teams SET current_month_spend_cents = current_month_spend_cents + $1 WHERE id = $2`
- **Zod on every input** — validate all tRPC procedure inputs before any business logic
- **Fire and forget for non-critical writes** — `writeAuditLog().catch(() => {})`, `db.update(apiKeys).set({ lastUsedAt }).execute().catch(() => {})` — never await in the hot path
- **NOT_FOUND not FORBIDDEN** — when a resource exists but the caller doesn't own it, return NOT_FOUND. Never confirm resource existence to unauthorized callers
- **AbortSignal on every model call** — `AbortSignal.timeout(timeoutSeconds * 1000)`. Never call a model without a timeout
- **Costs are integer cents** — never floats. Always `Math.ceil()` on cost calculations
- **Server timestamps only** — always `new Date()` on the server. Never trust client-provided timestamps
- **billing_period is YYYY-MM** — string format, always, for easy GROUP BY

---

## Auth — two surfaces, one context

**Dashboard users** (Supabase JWT — token starts with `eyJ`):
- Validate via `supabaseAnon.auth.getUser(token)` — never decode client-side
- Load team membership from `team_members` table
- Pass `req` to `resolveJwt` to read `req.query.teamId` for multi-team users
- Returns: `DashboardAuth { type: 'dashboard', userId, teamId, role }`

**API key users** (token starts with `olay_`):
- Hash with SHA-256 via `hashApiKey(token)`, look up in `api_keys`
- Returns: `ApiKeyAuth { type: 'apikey', projectId, teamId, scopes, keyId }`

Both carry `teamId` — this is the gate for cost logs, rate limits, and billing.

**API key format:** `olay_${randomBytes(32).toString('hex')}`
**Hash:** SHA-256 only — not bcrypt (API keys are high-entropy; speed matters)
**Storage:** hash only in DB; show raw key exactly once on creation

---

## Safety rules (8 checks, run on every file operation)

| Rule | Trigger | Severity |
|---|---|---|
| `protected_file` | `.env*`, lockfiles (`*.lock`, `*.lockb`) | block |
| `file_deletion` | `operation=delete` AND `allowFileDeletion=false` | block |
| `framework_change` | `package.json`, `tsconfig.json`, `vite.config.*`, `next.config.*` | block |
| `config_file_change` | `*.config.*`, `.eslintrc`, `.prettierrc`, Dockerfile | warn |
| `test_deletion` | delete + test file pattern (`*.test.*`, `*.spec.*`, `__tests__/`) | block |
| `custom_blocked_path` | path matches `project.safetyRules.customBlockedPaths[]` | block |
| `large_change` | before > 50 lines AND change ratio > 80% | warn |
| `potential_secret` | regex: `api_key=`, `sk-xxx`, JWT pattern, `PRIVATE KEY` in afterContent | block |

Blocked diffs **cannot be approved via API**. The `blocked` flag is cleared only by changing project safety settings — not by the approve endpoint.

---

## Task state machine

```
submitted -> routing -> executing -> completed
                               -> failed
submitted|routing|executing   -> cancelled
```

Transitions are one-way. Completed and failed tasks cannot be retried — create a new task.

---

## n8n boundary

n8n handles outbound integrations only. It is never in the request/response path.

Events emitted via `emitEvent()` (fire-and-forget, 3s timeout):
- `task.completed` — customer webhook delivery, Slack, Linear
- `task.failed` — failure alerts
- `diff.flagged` — safety alerts
- `cost.threshold_exceeded` — billing alerts

If `N8N_WEBHOOK_URL` env var is not set, `emitEvent()` silently returns. The product works fully without n8n.

---

## Hard prohibitions

- Never use n8n for routing, model calls, diff engine, or cost logging — those are Express/pg-boss
- Never auto-apply diffs unless `project.autoApplyChanges = true`
- Never store raw API keys — SHA-256 hash only
- Never use `*` as CORS origin when credentials are in use
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend
- Never call `resolveModel()` without first calling `estimateTokens()`
- Never add auth logic inside procedures — use guard middleware
- Never use `console.log` in production paths — `console.error` for actual errors only

---

## Launch gate — must pass before shipping

1. Create Supabase project, run migrations, set all env vars
2. Start server locally
3. Sign up, copy API key from dashboard
4. Run: `ORCHESTRALAY_API_KEY=olay_xxx npx orchestralay submit --prompt "Add a console.log to this function: function greet(name) { return 'hello ' + name }" --type code_generation`
5. Watch dashboard: `submitted -> routing -> executing -> completed`
6. Cost appears in Costs view
7. Diff appears in Diff Review — one modify operation
8. Approve the diff
9. Run: `npx orchestralay apply --task-id <id>`
10. File changed on disk

All 10 steps must pass. If any fail, do not ship.
