import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router } from '../trpc/trpc.js'
import { authedProcedure, dashboardProcedure, apiKeyProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
// Bug 4 fix: correct imports
import { tasks, diffs } from '../db/schema.js'
import { eq, and, desc, count } from 'drizzle-orm'
import { getQueue } from '../lib/queue.js'
import { enforceBudget } from '../lib/budgetGuard.js'
import { enforceRateLimit } from '../lib/rateLimiter.js'
import { QUEUE_NAME } from '../workers/orchestrateTask.js'
import { writeAuditLog } from '../lib/audit.js'

export const tasksRouter = router({
  submit: apiKeyProcedure('tasks:write')
    .input(
      z.object({
        prompt: z.string().min(1).max(50000),
        taskType: z.enum(['code_generation', 'debugging', 'refactoring', 'analysis', 'review']),
        preferredModels: z.array(z.string()).optional(),
        budgetCents: z.number().int().positive().optional(),
        timeoutSeconds: z.number().int().min(10).max(300).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Rate limiting
      await enforceRateLimit(ctx.auth.keyId)

      // Budget check
      await enforceBudget(ctx.auth.projectId, ctx.auth.teamId)

      // Insert task
      const [task] = await db.insert(tasks).values({
        projectId: ctx.auth.projectId,
        teamId: ctx.auth.teamId,
        prompt: input.prompt,
        taskType: input.taskType,
        status: 'submitted',
        preferredModels: input.preferredModels,
        budgetCents: input.budgetCents,
        timeoutSeconds: input.timeoutSeconds ?? 120,
      }).returning()

      // Enqueue job — fire and forget
      const queue = await getQueue()
      await queue.send(QUEUE_NAME, { taskId: task.id })

      writeAuditLog({
        teamId: ctx.auth.teamId,
        action: 'task.submitted',
        resource: 'task',
        resourceId: task.id,
      })

      return {
        taskId: task.id,
        realtimeChannel: `task:${task.id}`,
      }
    }),

  getStatus: authedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(tasks.id, input.taskId), eq(tasks.teamId, ctx.auth.teamId)]
      if (ctx.auth.type === 'apikey') {
        conditions.push(eq(tasks.projectId, ctx.auth.projectId))
      }

      const [task] = await db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .limit(1)

      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' })
      }

      // Get diff count
      const [diffCount] = await db
        .select({ count: count() })
        .from(diffs)
        .where(eq(diffs.taskId, task.id))

      return {
        ...task,
        diffCount: diffCount?.count ?? 0,
        baselineCostCents: task.metadata?.baselineCostCents ?? null,
        directSavingsCents: task.metadata?.directSavingsCents ?? null,
      }
    }),

  list: dashboardProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        status: z.enum(['submitted', 'routing', 'executing', 'completed', 'failed', 'cancelled']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(tasks.teamId, ctx.auth.teamId)]
      if (input.status) {
        conditions.push(eq(tasks.status, input.status))
      }

      const items = await db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(desc(tasks.createdAt))
        .limit(input.limit)
        .offset(input.offset)

      const [total] = await db
        .select({ count: count() })
        .from(tasks)
        .where(and(...conditions))

      return {
        items,
        total: total?.count ?? 0,
      }
    }),

  cancel: authedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conditions = [eq(tasks.id, input.taskId), eq(tasks.teamId, ctx.auth.teamId)]
      if (ctx.auth.type === 'apikey') {
        conditions.push(eq(tasks.projectId, ctx.auth.projectId))
      }

      const [task] = await db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .limit(1)

      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' })
      }

      // Only cancellable in active states
      if (!['submitted', 'routing', 'executing'].includes(task.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot cancel task in ${task.status} state`,
        })
      }

      await db
        .update(tasks)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(tasks.id, input.taskId))

      writeAuditLog({
        teamId: ctx.auth.teamId,
        action: 'task.cancelled',
        resource: 'task',
        resourceId: input.taskId,
      })

      return { success: true }
    }),
})
