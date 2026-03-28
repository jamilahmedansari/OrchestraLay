# System Architecture

> **Status:** Implemented (steps 1-29 of 30). Backend, frontend, CLI, and Dockerfile are complete. Remaining: step 26 (E2E verification with live Supabase) and step 30 (Stripe checkout + webhook).

---

## Overview

OrchestraLay is a single-service application that accepts AI task requests, routes them to the best available model, runs every proposed code change through a safety layer, and presents unified diffs for explicit approval before anything touches the filesystem.

```
┌─────────────────────────────────────────────────────────────┐
│                     Developer Machine                       │
│                                                             │
│   CLI (orchestralay submit/status/apply)                    │
│     │                              ▲                        │
│     │ POST /trpc/tasks.submit      │ apply writes files     │
│     ▼                              │                        │
└─────┼──────────────────────────────┼────────────────────────┘
      │                              │
      ▼                              │
┌─────────────────────────────────────────────────────────────┐
│                    OrchestraLay Server                       │
│                   (Express + tRPC)                           │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│  │  Auth     │  │  Rate    │  │  Budget   │  │  tRPC     │  │
│  │  Context  │  │  Limiter │  │  Guard    │  │  Routers  │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └─────┬─────┘  │
│       └──────────────┴──────────────┴──────────────┘        │
│                          │                                   │
│                    ┌─────▼─────┐                             │
│                    │  pg-boss  │                              │
│                    │  Queue    │                              │
│                    └─────┬─────┘                             │
│                          │                                   │
│                    ┌─────▼──────────────────────┐            │
│                    │  Orchestration Worker       │            │
│                    │                             │            │
│                    │  Routing ──► Model Call     │            │
│                    │     │          │            │            │
│                    │     │     ┌────▼────┐       │            │
│                    │     │     │  Diff   │       │            │
│                    │     │     │  Engine │       │            │
│                    │     │     └─────────┘       │            │
│                    └────────────────────────────┘            │
│                                                             │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │  Supabase    │  │  n8n      │  │  Supabase Realtime   │  │
│  │  PostgreSQL  │  │  (opt.)   │  │  (live updates)      │  │
│  └──────────────┘  └───────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
      ▲
      │
┌─────┴───────────────────────────────────────────────────────┐
│                    Dashboard (Vite + React 19)               │
│                                                             │
│   Overview   │   Costs   │   Diff Review                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Request Lifecycle

A task flows through these stages:

1. **Submit** — CLI or SDK sends `tasks.submit` with an API key (`olay_*`)
2. **Auth** — Token is SHA-256 hashed and looked up in `api_keys`
3. **Rate limit** — Per-key bucket check (per-minute + per-day)
4. **Budget check** — Team monthly cap and project cap enforcement
5. **Queue** — Task is inserted as `submitted`, job is enqueued in pg-boss
6. **Route** — Worker picks up the job, runs the 6-gate model router (see [Routing Engine](./routing-engine.md))
7. **Execute** — Selected model is called with AbortSignal timeout; failover on failure
8. **Diff** — Model output is parsed into file operations, diffs are computed, safety rules are checked (see [Safety & Diffs](./safety-and-diffs.md))
9. **Complete** — Task status is set to `completed`, costs are logged, dashboard is updated in real time
10. **Apply** — Developer reviews diffs in dashboard or CLI, approves, then runs `orchestralay apply` to write files to disk

---

## Layer Boundaries

### Express (request path)
Handles HTTP, tRPC routing, auth resolution, rate limiting, and budget checks. Synchronous request/response. Never calls AI models directly.

### pg-boss Worker (async processing)
Runs inside the same process. Picks up queued tasks and orchestrates the full lifecycle: routing, model calls, diff engine, cost logging, and real-time broadcasts. Configured for `teamSize: 5` (5 concurrent jobs) and `teamConcurrency: 3`.

### Frontend (Vite + React 19)
Static SPA served separately in dev (port 5173). Three pages: Overview, Costs, Diff Review. Connects to backend via tRPC client and Supabase Realtime for live updates.

### CLI
Runs on the developer's machine. Submits tasks, polls status, fetches approved diffs, and writes files to disk. The only component that touches the filesystem.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **pg-boss over Redis/BullMQ** | One fewer infrastructure dependency. pg-boss uses the same PostgreSQL database, so no separate queue service to manage. |
| **tRPC over REST** | End-to-end type safety between server and frontend. Zod validation on every input. |
| **Single-service deployment** | Server and worker run in the same Node.js process. Simpler deployment on Railway (one Dockerfile, one service). Queue coordination happens via PostgreSQL. |
| **Diffs never auto-apply** | Safety is the core value prop. The diff engine produces data only — writing to disk is always the CLI's job after explicit approval. Exception: `project.autoApplyChanges = true`. |
| **Costs in integer cents** | Avoids floating-point rounding errors. All cost math uses `Math.ceil()`. |
| **SHA-256 for API keys (not bcrypt)** | API keys are high-entropy random tokens. SHA-256 is sufficient and fast — bcrypt's slow hashing is designed for low-entropy passwords. |

---

## Database

14 tables in Supabase PostgreSQL via Drizzle ORM, defined in `server/db/schema.ts`.

Core relationships:
```
users
  └── team_members ──► teams
                        ├── projects
                        │    ├── api_keys → rate_limit_buckets
                        │    ├── tasks → model_results, diffs
                        │    ├── integrations
                        │    └── webhooks
                        ├── cost_logs
                        └── team_billing_history
feature_flags            (standalone)
audit_logs               (nullable FKs — survives cascade deletes)
```

Key schema details:
- All FKs use `ON DELETE CASCADE` except `audit_logs` which uses `SET NULL`
- `billing_period` (format: `YYYY-MM`) is the primary dimension for cost aggregation
- `teams.currentMonthSpendCents` is updated atomically via raw SQL (the only raw SQL in the codebase)
- `projects.safetyRules` is JSONB: `{ allowFileDeletion?, allowFrameworkChanges?, allowTestFileDeletion?, customBlockedPaths?: string[] }`
- `tasks.status` values: `submitted`, `routing`, `executing`, `completed`, `failed`, `cancelled`
- `diffs.hunks` stores structured hunk data: `{ oldStart, oldLines, newStart, newLines, lines: string[] }`

---

## Module System

The codebase is **ESM-only**. All local imports must use `.js` extensions even in `.ts` files:
```typescript
import { db } from '../db/index.js'
```

---

## Startup Order

The server must start in this exact sequence:

```
1. Initialize pg-boss queue       ← getQueue()
2. Start orchestration worker     ← startOrchestrationWorker()
3. Start Express server           ← app.listen(PORT)
```

Starting the server before the worker means tasks are accepted but never processed. Starting the worker before the queue means it crashes.

This was originally Bug 3 in CLAUDE.md — now fixed in `server/index.ts` (line ~36-37).

---

## Health Check

The server exposes a health endpoint at:
```
GET /health → { status: 'ok', timestamp: '...' }
```

This is used by Railway's healthcheck (configured in `railway.toml` with 30s timeout).
