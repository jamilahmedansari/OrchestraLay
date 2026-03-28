import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router } from '../trpc/trpc.js'
import { dashboardProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { apiKeys, projects } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { generateApiKey, hashApiKey } from '../lib/hashKey.js'
import { writeAuditLog } from '../lib/audit.js'

export const authRouter = router({
  createApiKey: dashboardProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(100),
        scopes: z.array(z.string()).default(['tasks:write']),
        expiresAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.teamId, ctx.auth.teamId)
        ),
      })

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })
      }

      const rawKey = generateApiKey()
      const keyHash = hashApiKey(rawKey)

      const [key] = await db
        .insert(apiKeys)
        .values({
          projectId: input.projectId,
          name: input.name,
          keyHash,
          keyPrefix: rawKey.slice(0, 12),
          scopes: input.scopes,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        })
        .returning()

      writeAuditLog({
        userId: ctx.auth.userId,
        teamId: ctx.auth.teamId,
        action: 'api_key.created',
        resource: 'api_key',
        resourceId: key.id,
      })

      return { id: key.id, rawKey, prefix: key.keyPrefix, name: key.name }
    }),

  listApiKeys: dashboardProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const project = await db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.teamId, ctx.auth.teamId)
        ),
      })

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })
      }

      const keys = await db.query.apiKeys.findMany({
        where: eq(apiKeys.projectId, input.projectId),
        columns: {
          id: true,
          name: true,
          keyPrefix: true,
          scopes: true,
          revoked: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
      })

      return keys
    }),

  revokeApiKey: dashboardProcedure
    .input(z.object({ keyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const key = await db.query.apiKeys.findFirst({
        where: eq(apiKeys.id, input.keyId),
        with: { project: true },
      })

      if (!key || key.project.teamId !== ctx.auth.teamId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' })
      }

      await db
        .update(apiKeys)
        .set({ revoked: true })
        .where(eq(apiKeys.id, input.keyId))

      writeAuditLog({
        userId: ctx.auth.userId,
        teamId: ctx.auth.teamId,
        action: 'api_key.revoked',
        resource: 'api_key',
        resourceId: input.keyId,
      })

      return { success: true }
    }),
})
