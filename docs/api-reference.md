# tRPC API Reference

> **Status:** Implementation in progress on branch `claude/add-claude-md-file-VA6l8` (tRPC routers). This documentation tracks the API as it is built by a parallel agent.

---

## Connection

The tRPC endpoint is at `/trpc` on the server (default `http://localhost:3001/trpc`).

All procedures use superjson for serialization (handles Date, BigInt, etc.). The frontend uses `@trpc/client` with `httpBatchLink`, and the CLI uses `@trpc/client` directly. Error formatting strips stack traces in production (`NODE_ENV=production`).

---

## Authentication

Every request must include an `Authorization: Bearer <token>` header.

- **Dashboard users:** Token is a Supabase JWT (starts with `eyJ`)
- **CLI / SDK:** Token is an API key (starts with `olay_`)

See [Authentication](./auth.md) for details on both flows.

---

## Procedures

### Tasks

#### `tasks.submit`
Submit a new AI task for processing.

- **Guard:** `apiKeyProcedure('tasks:write')`
- **Caller:** CLI / SDK only

**Input:**
```typescript
{
  prompt: string              // The task prompt
  taskType: 'code_generation' | 'debugging' | 'refactoring' | 'analysis' | 'review'
  preferredModels?: string[]  // Optional model preference order
  budgetCents?: number        // Optional max cost in cents
  timeoutSeconds?: number     // Optional model call timeout (default 120s)
}
```

**Response:**
```typescript
{
  taskId: string
  realtimeChannel: string     // Supabase Realtime channel for live updates
}
```

**Errors:**
- `TOO_MANY_REQUESTS` — Rate limit exceeded (includes `retryAfter` seconds)
- `FORBIDDEN` — Budget cap exceeded

---

#### `tasks.getStatus`
Get current status and metadata for a task.

- **Guard:** `authedProcedure`
- **Caller:** Both

**Input:** `{ taskId: string }`

**Response:** Full task record plus `pendingDiffs` count:
```typescript
{
  id: string
  status: 'submitted' | 'routing' | 'executing' | 'completed' | 'failed' | 'cancelled'
  taskType: string
  prompt: string
  selectedModel: string | null
  actualCostCents: number | null
  estimatedCostCents: number | null
  metadata: {
    reasoning: string[]       // Routing decision log
  } | null
  errorMessage: string | null
  pendingDiffs: number
  createdAt: string
  completedAt: string | null
}
```

---

#### `tasks.list`
List tasks for the team with pagination.

- **Guard:** `dashboardProcedure`
- **Caller:** Dashboard only

**Input:**
```typescript
{
  limit?: number              // Default 50
  offset?: number             // Default 0
  status?: string             // Filter by status
}
```

**Response:**
```typescript
{
  tasks: Task[]
  total: number
}
```

---

#### `tasks.cancel`
Cancel a task that is still in progress.

- **Guard:** `authedProcedure`
- **Caller:** Both

**Input:** `{ taskId: string }`

Only works for tasks in `submitted`, `routing`, or `executing` status. Completed and failed tasks cannot be cancelled.

---

### Diffs

#### `diffs.getForTask`
Get all diffs for a specific task.

- **Guard:** `authedProcedure`
- **Caller:** Both

**Input:** `{ taskId: string }`

**Response:** Array of diff summaries:
```typescript
Array<{
  id: string
  filePath: string
  operation: 'create' | 'modify' | 'delete'
  linesAdded: number
  linesRemoved: number
  status: string
  flagged: boolean
  blocked: boolean
  safetyViolations: Array<{ rule: string, severity: 'warn' | 'block', message: string }>
  applied: boolean
  createdAt: string
}>
```

---

#### `diffs.getPendingForTeam`
Get all pending (unapproved) diffs across the team.

- **Guard:** `dashboardProcedure`
- **Caller:** Dashboard only

---

#### `diffs.getContent`
Get full diff content including before/after file content and unified diff hunks.

- **Guard:** `authedProcedure`
- **Caller:** Both

**Input:** `{ diffId: string }`

---

#### `diffs.approve`
Approve a single diff for application.

- **Guard:** `authedProcedure`
- **Caller:** Both

**Input:** `{ diffId: string }`

**Errors:**
- `FORBIDDEN` — Diff is blocked by safety rules. Change project settings to unblock.

---

#### `diffs.reject`
Reject a diff.

- **Guard:** `authedProcedure`
- **Input:** `{ diffId: string }`

---

#### `diffs.approveAll`
Approve all non-blocked diffs for a task.

- **Guard:** `authedProcedure`
- **Input:**
```typescript
{
  taskId: string
  skipFlagged?: boolean       // If true, skip warned diffs too
}
```

---

#### `diffs.markApplied`
Mark diffs as applied after writing to disk (called by CLI).

- **Guard:** `apiKeyProcedure('tasks:write')`
- **Caller:** CLI / SDK only

**Input:** `{ diffIds: string[] }`

---

#### `diffs.revert`
Revert a single applied diff (resets to pending, clears applied state).

- **Guard:** `authedProcedure`
- **Input:** `{ diffId: string }`
- **Response:** `{ beforeContent: string | null, filePath: string }` — the CLI uses this to restore the original file

---

### Dashboard

#### `dashboard.getOverview`
Aggregated metrics for the team dashboard.

- **Guard:** `dashboardProcedure`

**Response:**
```typescript
{
  tasksToday: number
  costTodayCents: number      // integer cents
  pendingDiffs: number
  failedToday: number
  recentTasks: Array<{
    id: string
    prompt: string
    taskType: string
    status: string
    selectedModel: string | null
    actualCostCents: number | null
    createdAt: string
  }>
}
```

---

#### `dashboard.getCosts`
Cost breakdown for the costs page.

- **Guard:** `dashboardProcedure`

**Input:**
```typescript
{
  days?: number               // 1-90, defaults to 7
}
```

**Response:**
```typescript
{
  budget: {
    monthlyBudgetCents: number
    currentSpendCents: number
    billingPeriod: string       // YYYY-MM
  } | null
  dailyCosts: Array<{ date: string, modelName: string, totalCents: number, totalTokens: number, requestCount: number }>
  modelBreakdown: Array<{ modelName: string, provider: string, totalCents: number, totalTokens: number, requestCount: number }>
}
```

---

### Auth (API Key Management)

#### `auth.createApiKey`
Create a new API key for a project.

- **Guard:** `dashboardProcedure`

**Input:**
```typescript
{
  projectId: string
  name: string
  scopes: string[]
  expiresAt?: string          // ISO date, optional
}
```

**Response:**
```typescript
{
  id: string
  rawKey: string              // Shown ONCE — not stored, not retrievable
  prefix: string              // e.g., "olay_a1b2c3"
  name: string
}
```

---

#### `auth.listApiKeys`
List API keys for a project (hashes only, never raw keys).

- **Guard:** `dashboardProcedure`
- **Input:** `{ projectId: string }`

**Response:** Array of:
```typescript
Array<{
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  revoked: boolean
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
}>
```

---

#### `auth.revokeApiKey`
Revoke an API key immediately.

- **Guard:** `dashboardProcedure`
- **Input:** `{ keyId: string }`

---

## Error Codes

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | Missing or invalid token |
| `FORBIDDEN` | Valid token but insufficient permissions (e.g., blocked diff approval, budget exceeded) |
| `NOT_FOUND` | Resource doesn't exist **or** caller doesn't own it |
| `TOO_MANY_REQUESTS` | Rate limit exceeded (check `retryAfter` in error data) |
| `BAD_REQUEST` | Zod validation failed on input |
| `INTERNAL_SERVER_ERROR` | Unexpected server error |

Note: `NOT_FOUND` is returned instead of `FORBIDDEN` when the resource exists but the caller doesn't own it. This prevents confirming resource existence to unauthorized callers.

---

## Rate Limiting

Rate limits are per API key, with two buckets (implemented in `server/lib/rateLimiter.ts`):
- **Per-minute:** 30 requests/minute
- **Per-day:** 1,000 requests/day

When exceeded, the error response includes `retryAfter` (seconds until the bucket resets). Rate limit state is stored in PostgreSQL (`rate_limit_buckets` table). Window resets are automatic — when the elapsed time exceeds the window duration, the counter resets.
