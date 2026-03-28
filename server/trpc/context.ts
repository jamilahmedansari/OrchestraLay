import type { Request } from 'express'
import { db } from '../db/index.js'
import { apiKeys, teamMembers, projects } from '../db/schema.js'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { hashApiKey } from '../lib/hashKey.js'
import { supabaseAnon } from '../lib/supabase.js'

// ─── Auth context union type ─────────────────────────────────────────

export type DashboardAuth = {
  type: 'dashboard'
  userId: string
  teamId: string
  role: string
}

export type ApiKeyAuth = {
  type: 'apikey'
  projectId: string
  teamId: string
  scopes: string[]
  keyId: string
}

export type NoAuth = { type: 'none' }

export type AuthContext = DashboardAuth | ApiKeyAuth | NoAuth

export type Context = {
  auth: AuthContext
  req: Request
}

// ─── Resolve JWT (Bug 1 fix: takes req explicitly) ──────────────────

async function resolveJwt(token: string, req: Request): Promise<AuthContext> {
  const { data, error } = await supabaseAnon.auth.getUser(token)
  if (error || !data.user) return { type: 'none' }

  const supabaseUserId = data.user.id

  // Read teamId from query for multi-team users
  const teamIdParam = req.query.teamId as string | undefined

  // Find user's team membership
  const memberships = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, supabaseUserId))

  if (memberships.length === 0) return { type: 'none' }

  // Use requested teamId or default to first membership
  const membership = teamIdParam
    ? memberships.find((m) => m.teamId === teamIdParam)
    : memberships[0]

  if (!membership) return { type: 'none' }

  return {
    type: 'dashboard',
    userId: supabaseUserId,
    teamId: membership.teamId,
    role: membership.role,
  }
}

// ─── Resolve API key ────────────────────────────────────────────────

async function resolveApiKey(token: string): Promise<AuthContext> {
  const hash = hashApiKey(token)

  const [key] = await db
    .select({
      id: apiKeys.id,
      projectId: apiKeys.projectId,
      teamId: apiKeys.teamId,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, hash),
        eq(apiKeys.revoked, false)
      )
    )
    .limit(1)

  if (!key) return { type: 'none' }

  // Fire-and-forget: update lastUsedAt
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .execute()
    .catch(() => {})

  return {
    type: 'apikey',
    projectId: key.projectId,
    teamId: key.teamId,
    scopes: key.scopes,
    keyId: key.id,
  }
}

// ─── Main auth resolver ─────────────────────────────────────────────

export async function resolveAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.authorization
  if (!authHeader) return { type: 'none' }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  if (!token) return { type: 'none' }

  // JWT tokens start with eyJ
  if (token.startsWith('eyJ')) {
    return resolveJwt(token, req)
  }

  // API keys start with olay_
  if (token.startsWith('olay_')) {
    return resolveApiKey(token)
  }

  return { type: 'none' }
}

// ─── Context factory for tRPC ────────────────────────────────────────

export async function createContext({ req }: { req: Request }): Promise<Context> {
  const auth = await resolveAuth(req)
  return { auth, req }
}
