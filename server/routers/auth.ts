import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router } from '../trpc/trpc.js'
import { dashboardProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { apiKeys, projects } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { generateApiKey } from '../lib/hashKey.js'
import { writeAuditLog } from '../lib/audit.js'

export const authRouter = router({
  createApiKey: dashboardProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(255),
        scopes: z.array(z.string()).optional(),
        expiresAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify project belongs to team — NOT_FOUND not FORBIDDEN
      const [project] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.teamId, ctx.auth.teamId)
          )
        )
        .limit(1)

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })
      }

      const { raw, hash, prefix } = generateApiKey()

      const [key] = await db.insert(apiKeys).values({
        projectId: input.projectId,
        teamId: ctx.auth.teamId,
        name: input.name,
        keyHash: hash,
        keyPrefix: prefix,
        scopes: input.scopes ?? ['tasks:write', 'tasks:read'],
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      }).returning()

      writeAuditLog({
        teamId: ctx.auth.teamId,
        userId: ctx.auth.userId,
        action: 'api_key.created',
        resource: 'api_key',
        resourceId: key.id,
      })

      // Return raw key exactly once — never stored
      return {
        id: key.id,
        name: key.name,
        prefix: key.keyPrefix,
        rawKey: raw,
        scopes: key.scopes,
        createdAt: key.createdAt,
      }
    }),

  listApiKeys: dashboardProcedure
    .input(
      z.object({
        projectId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(apiKeys.teamId, ctx.auth.teamId)]
      if (input.projectId) {
        conditions.push(eq(apiKeys.projectId, input.projectId))
      }

      return db
        .select({
          id: apiKeys.id,
          projectId: apiKeys.projectId,
          name: apiKeys.name,
          prefix: apiKeys.keyPrefix,
          scopes: apiKeys.scopes,
          revoked: apiKeys.revoked,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(and(...conditions))
        .orderBy(desc(apiKeys.createdAt))
    }),

  revokeApiKey: dashboardProcedure
    .input(z.object({ keyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [key] = await db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.id, input.keyId),
            eq(apiKeys.teamId, ctx.auth.teamId)
          )
        )
        .limit(1)

      if (!key) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' })
      }

      await db
        .update(apiKeys)
        .set({ revoked: true })
        .where(eq(apiKeys.id, input.keyId))

      writeAuditLog({
        teamId: ctx.auth.teamId,
        userId: ctx.auth.userId,
        action: 'api_key.revoked',
        resource: 'api_key',
        resourceId: input.keyId,
      })

      return { success: true }
    }),
})
