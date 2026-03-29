# Authentication

> **Status:** Implementation in progress on branch `claude/add-claude-md-file-VA6l8` (auth context and guards). This documentation tracks the auth system as it is built by a parallel agent.

---

## Two Auth Surfaces, One Context

OrchestraLay has two types of callers, each authenticated differently, but both resolve to a context that carries `teamId` — the universal gate for billing, rate limits, and access control.

```
                  ┌─────────────────┐
  Dashboard ────► │  Supabase JWT   │ ──► DashboardAuth { userId, teamId, role }
  (browser)       │  (eyJ... token) │
                  └─────────────────┘

                  ┌─────────────────┐
  CLI / SDK ────► │  API Key        │ ──► ApiKeyAuth { projectId, teamId, scopes, keyId }
                  │  (olay_... key) │
                  └─────────────────┘
```

---

## Dashboard Auth (JWT)

Used by the React dashboard in the browser.

**Flow:**
1. User signs up / logs in via Supabase Auth (email + password)
2. Supabase returns a JWT (starts with `eyJ`)
3. Every tRPC request sends the JWT in the `Authorization: Bearer` header
4. Server validates via `supabaseAnon.auth.getUser(token)` — server-side, never decoded client-side
5. Server loads team membership from the `team_members` table
6. For multi-team users, `req.query.teamId` specifies which team context to use

**Result:**
```typescript
{ type: 'dashboard', userId: string, teamId: string, role: string }
```

**Roles:** `admin`, `member` (default) — enforced by guard middleware, not by procedures. The `team_members` table has a unique constraint on `(userId, teamId)`.

---

## API Key Auth

Used by the CLI and any SDK/integration.

**Key format:** `olay_` followed by 32 random hex bytes
```
olay_a1b2c3d4e5f6...  (69 characters total: 5 prefix + 64 hex)
```

**Flow:**
1. Developer creates an API key in the dashboard (Auth > Create API Key)
2. Raw key is shown **exactly once** — copy it immediately
3. CLI reads key from `ORCHESTRALAY_API_KEY` environment variable
4. Server hashes the key with SHA-256 and looks it up in the `api_keys` table
5. Lookup includes: `revoked = false` and `expires_at IS NULL OR expires_at > now()`
6. Server loads `project.teamId` via join

**Result:**
```typescript
{ type: 'apikey', projectId: string, teamId: string, scopes: string[], keyId: string }
```

**Scopes:** Default is `['tasks:write']`. Checked by `apiKeyProcedure(scope)` middleware. The `lastUsedAt` timestamp is updated on every successful auth (fire-and-forget, never awaited in the hot path).

---

## Why SHA-256 (Not Bcrypt)

API keys are 32 bytes of cryptographic randomness — they have maximum entropy. Bcrypt is designed for low-entropy passwords where brute-force is a real threat. For high-entropy tokens:

- SHA-256 is sufficient (no practical brute-force)
- SHA-256 is fast (matters when every API request needs a lookup)
- Bcrypt's intentional slowness adds latency with no security benefit

---

## Security Model

### Hash-only storage
The raw API key is never stored in the database. Only the SHA-256 hash is persisted. If the database is compromised, attackers get hashes, not usable keys.

### NOT_FOUND, not FORBIDDEN
When a resource exists but the caller doesn't own it, the API returns `NOT_FOUND`. This prevents attackers from confirming whether resources exist via error codes.

### Team-scoped access
Both auth types resolve to a `teamId`. All downstream queries filter by `teamId`:
- Cost logs are scoped to the team
- Rate limits are per-key (which belongs to a project, which belongs to a team)
- Budget enforcement checks team monthly spend
- Dashboard data only shows the team's tasks, diffs, and costs

---

## API Key Lifecycle

1. **Create** — Dashboard: Auth > Create API Key. Choose project and scopes. Raw key shown once.
2. **Use** — Set `ORCHESTRALAY_API_KEY=olay_xxx` in your environment. CLI and SDK read this.
3. **Rotate** — Create a new key, update your environment, revoke the old key.
4. **Revoke** — Dashboard: Auth > Revoke. Immediate. All requests with the old key return UNAUTHORIZED.
5. **Expire** — Optional expiry date set at creation. Key stops working after that date automatically.

---

## Which Procedures Use Which Auth

| Auth Type | Procedures | Typical Caller |
|---|---|---|
| `apiKeyProcedure('tasks:write')` | `tasks.submit`, `diffs.markApplied` | CLI / SDK |
| `authedProcedure` | `tasks.getStatus`, `tasks.cancel`, `diffs.approve`, `diffs.reject`, etc. | Both |
| `dashboardProcedure` | `dashboard.getOverview`, `dashboard.getCosts`, `auth.*`, `tasks.list` | Dashboard only |

See [API Reference](./api-reference.md) for the complete procedure matrix.
