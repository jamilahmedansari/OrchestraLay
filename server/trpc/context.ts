import type { Request } from 'express'
import { supabaseAnon } from '../lib/supabase.js'
import { hashApiKey } from '../lib/hashKey.js'
import { db } from '../db/index.js'
import { apiKeys, projects, teamMembers } from '../db/schema.js'
import { eq, and, isNull, gt } from 'drizzle-orm'

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

async function resolveJwt(token: string, req: Request): Promise<AuthContext> {
  const { data, error } = await supabaseAnon.auth.getUser(token)
  if (error || !data.user) return { type: 'none' }

  const teamId = req.query.teamId as string | undefined

  const membership = await db.query.teamMembers.findFirst({
    where: teamId
      ? and(eq(teamMembers.userId, data.user.id), eq(teamMembers.teamId, teamId))
      : eq(teamMembers.userId, data.user.id),
  })

  if (!membership) return { type: 'none' }

  return {
    type: 'dashboard',
    userId: data.user.id,
    teamId: membership.teamId,
    role: membership.role,
  }
}

async function resolveApiKey(token: string): Promise<AuthContext> {
  const hash = hashApiKey(token)

  const key = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.keyHash, hash),
      eq(apiKeys.revoked, false)
    ),
    with: { project: true },
  })

  if (!key) return { type: 'none' }

  if (key.expiresAt && key.expiresAt < new Date()) {
    return { type: 'none' }
  }

  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .execute()
    .catch(() => {})

  return {
    type: 'apikey',
    projectId: key.projectId,
    teamId: key.project.teamId,
    scopes: key.scopes,
    keyId: key.id,
  }
}

async function resolveAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.authorization
  if (!authHeader) return { type: 'none' }

  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return { type: 'none' }

  if (token.startsWith('eyJ')) {
    return resolveJwt(token, req)
  }

  if (token.startsWith('olay_')) {
    return resolveApiKey(token)
  }

  return { type: 'none' }
}

export async function createContext({ req }: { req: Request }): Promise<Context> {
  const auth = await resolveAuth(req)
  return { auth, req }
}
