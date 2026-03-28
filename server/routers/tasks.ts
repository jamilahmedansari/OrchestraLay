import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router } from '../trpc/trpc.js'
import { authedProcedure, dashboardProcedure, apiKeyProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { tasks, projects, modelResults, diffs, costLogs } from '../db/schema.js'
import { eq, and, desc, inArray, count, gte, sql } from 'drizzle-orm'
import { getQueue } from '../lib/queue.js'
import { enforceRateLimit } from '../lib/rateLimiter.js'
import { enforceBudget } from '../lib/budgetGuard.js'
import { writeAuditLog } from '../lib/audit.js'

const taskTypeEnum = z.enum([
  'code_generation',
  'debugging',
  'refactoring',
  'analysis',
  'review',
])

export const tasksRouter = router({
  submit: apiKeyProcedure('tasks:write')
    .input(
      z.object({
        prompt: z.string().min(1).max(50000),
        taskType: taskTypeEnum,
        preferredModels: z.array(z.string()).optional(),
        budgetCents: z.number().int().positive().optional(),
        timeoutSeconds: z.number().int().min(10).max(600).default(120),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await enforceRateLimit(ctx.auth.keyId)
      await enforceBudget(ctx.auth.projectId, ctx.auth.teamId)

      const [task] = await db
        .insert(tasks)
        .values({
          projectId: ctx.auth.projectId,
          teamId: ctx.auth.teamId,
          prompt: input.prompt,
          taskType: input.taskType,
          status: 'submitted',
          preferredModels: input.preferredModels,
          budgetCents: input.budgetCents,
          timeoutSeconds: input.timeoutSeconds,
        })
        .returning()

      const queue = await getQueue()
      await queue.send('orchestrate-task', {
        taskId: task.id,
        projectId: ctx.auth.projectId,
        teamId: ctx.auth.teamId,
        prompt: input.prompt,
        taskType: input.taskType,
        preferredModels: input.preferredModels,
        budgetCents: input.budgetCents,
        timeoutSeconds: input.timeoutSeconds,
      })

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
      const teamId =
        ctx.auth.type === 'dashboard' ? ctx.auth.teamId : ctx.auth.teamId

      const task = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.taskId), eq(tasks.teamId, teamId)),
      })

      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' })
      }

      const [diffCount] = await db
        .select({ count: count() })
        .from(diffs)
        .where(eq(diffs.taskId, task.id))

      return {
        ...task,
        pendingDiffs: diffCount.count,
      }
    }),

  list: dashboardProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        status: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(tasks.teamId, ctx.auth.teamId)]
      if (input.status) {
        conditions.push(eq(tasks.status, input.status))
      }

      const taskList = await db.query.tasks.findMany({
        where: and(...conditions),
        orderBy: [desc(tasks.createdAt)],
        limit: input.limit,
        offset: input.offset,
      })

      const [totalCount] = await db
        .select({ count: count() })
        .from(tasks)
        .where(and(...conditions))

      return {
        tasks: taskList,
        total: totalCount.count,
      }
    }),

  cancel: authedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const teamId =
        ctx.auth.type === 'dashboard' ? ctx.auth.teamId : ctx.auth.teamId

      const task = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.taskId), eq(tasks.teamId, teamId)),
      })

      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' })
      }

      const cancellable = ['submitted', 'routing', 'executing']
      if (!cancellable.includes(task.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot cancel task in '${task.status}' state`,
        })
      }

      await db
        .update(tasks)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(tasks.id, input.taskId))

      writeAuditLog({
        teamId,
        action: 'task.cancelled',
        resource: 'task',
        resourceId: input.taskId,
      })

      return { success: true }
    }),
})
