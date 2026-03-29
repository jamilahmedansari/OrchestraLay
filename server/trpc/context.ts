import type { Request, Response } from 'express'

import type { CreateExpressContextOptions } from '@trpc/server/adapters/express'
import { TRPCError } from '@trpc/server'
import { and, eq, gt, isNull, or } from 'drizzle-orm'

import { db } from '../db/index.js'
import { apiKeys, projects, teamMembers } from '../db/schema.js'
import { hashApiKey } from '../lib/hashKey.js'
import { supabaseAnon } from '../lib/supabase.js'

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

export type AuthContext = DashboardAuth | ApiKeyAuth | { type: 'none' }

export type TrpcContext = {
  req: Request
  res: Response
  auth: AuthContext
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return null
  }

  return header.slice('Bearer '.length).trim()
}

async function resolveJwt(token: string, req: Request): Promise<DashboardAuth | { type: 'none' }> {
  const { data, error } = await supabaseAnon.auth.getUser(token)

  if (error || !data.user) {
    return { type: 'none' }
  }

  const requestedTeamId = typeof req.query.teamId === 'string' ? req.query.teamId : undefined
  const memberships = await db
    .select({
      teamId: teamMembers.teamId,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .where(
      requestedTeamId
        ? and(eq(teamMembers.userId, data.user.id), eq(teamMembers.teamId, requestedTeamId))
        : eq(teamMembers.userId, data.user.id),
    )
    .limit(1)

  const membership = memberships[0]

  if (!membership) {
    return { type: 'none' }
  }

  return {
    type: 'dashboard',
    userId: data.user.id,
    teamId: membership.teamId,
    role: membership.role,
  }
}

async function resolveApiKey(token: string): Promise<ApiKeyAuth | { type: 'none' }> {
  const keyHash = hashApiKey(token)
  const now = new Date()
  const rows = await db
    .select({
      keyId: apiKeys.id,
      projectId: apiKeys.projectId,
      teamId: projects.teamId,
      scopes: apiKeys.scopes,
    })
    .from(apiKeys)
    .innerJoin(projects, eq(projects.id, apiKeys.projectId))
    .where(
      and(
        eq(apiKeys.keyHash, keyHash),
        eq(apiKeys.revoked, false),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
      ),
    )
    .limit(1)

  const match = rows[0]

  if (!match) {
    return { type: 'none' }
  }

  db.update(apiKeys)
    .set({ lastUsedAt: now })
    .where(eq(apiKeys.id, match.keyId))
    .execute()
    .catch(() => {})

  return {
    type: 'apikey',
    projectId: match.projectId,
    teamId: match.teamId,
    scopes: match.scopes,
    keyId: match.keyId,
  }
}

export async function resolveAuth(req: Request): Promise<AuthContext> {
  const token = getBearerToken(req)

  if (!token) {
    return { type: 'none' }
  }

  if (token.startsWith('eyJ')) {
    return resolveJwt(token, req)
  }

  if (token.startsWith('olay_')) {
    return resolveApiKey(token)
  }

  return { type: 'none' }
}

export async function createContext({ req, res }: CreateExpressContextOptions): Promise<TrpcContext> {
  const auth = await resolveAuth(req)

  return {
    req,
    res,
    auth,
  }
}

export function requireAuth(auth: AuthContext): asserts auth is DashboardAuth | ApiKeyAuth {
  if (auth.type === 'none') {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
}