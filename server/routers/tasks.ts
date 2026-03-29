// tasks.ts — task lifecycle router

import { z } from 'zod'
import { eq, desc, and } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter } from '../trpc/trpc.js'
import { authedProcedure, dashboardProcedure, apiKeyProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { tasks } from '../db/schema.js'
import { getQueue } from '../lib/queue.js'
import { ORCHESTRATE_TASK_JOB, type OrchestrateTaskPayload } from '../workers/orchestrateTask.js'
import { estimateTokens } from '../lib/tokenizer.js'
import { assertBudget } from '../lib/budgetGuard.js'
import { writeAuditLog } from '../lib/audit.js'

const taskTypeEnum = z.enum(['code_generation', 'debugging', 'refactoring', 'analysis', 'review'])

export const tasksRouter = createTRPCRouter({
  // POST /trpc/tasks.submit — requires API key with 'tasks:write' scope
  submit: apiKeyProcedure('tasks:write').input(
    z.object({
      prompt: z.string().min(1).max(32000),
      taskType: taskTypeEnum,
      preferredModel: z.string().optional(),
      budgetCapCents: z.number().int().positive().optional(),
    }),
  ).mutation(async ({ ctx, input }) => {
    const { projectId, teamId, keyId } = ctx.auth

    // Pre-flight budget check
    const estimatedCost = Math.ceil(estimateTokens(input.prompt) * 0.003 * 100) // conservative
    await assertBudget(teamId, estimatedCost)

    // Create task record
    const [task] = await db.insert(tasks).values({
      teamId,
      projectId,
      submittedByKeyId: keyId,
      prompt: input.prompt,
      taskType: input.taskType,
      status: 'submitted',
      preferredModel: input.preferredModel ?? null,
    }).returning()

    if (!task) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create task' })

    await writeAuditLog({
      teamId,
      action: 'task.submitted',
      resourceType: 'task',
      resourceId: task.id,
      metadata: { taskType: input.taskType, promptLength: input.prompt.length },
    })

    // Enqueue for worker
    const jobPayload: OrchestrateTaskPayload = {
      taskId: task.id,
      teamId,
      projectId,
      prompt: input.prompt,
      taskType: input.taskType,
      preferredModel: input.preferredModel,
      budgetCapCents: input.budgetCapCents,
    }

    const queue = await getQueue()
    await queue.send(ORCHESTRATE_TASK_JOB, jobPayload)

    return { taskId: task.id, status: 'submitted' }
  }),

  // GET /trpc/tasks.get — get single task status
  get: authedProcedure.input(z.object({ taskId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const teamId = ctx.auth.type === 'dashboard' ? ctx.auth.teamId : ctx.auth.teamId

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.teamId, teamId)))
      .limit(1)

    if (!task) throw new TRPCError({ code: 'NOT_FOUND' })
    return task
  }),

  // GET /trpc/tasks.list — list tasks for team/project
  list: dashboardProcedure.input(
    z.object({
      projectId: z.string().uuid().optional(),
      status: z.enum(['submitted', 'routing', 'executing', 'completed', 'failed', 'cancelled']).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }),
  ).query(async ({ ctx, input }) => {
    const { teamId } = ctx.auth
    const conditions = [eq(tasks.teamId, teamId)]
    if (input.projectId) conditions.push(eq(tasks.projectId, input.projectId))
    if (input.status) conditions.push(eq(tasks.status, input.status))

    const rows = await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(input.limit)
      .offset(input.offset)

    return rows
  }),

  // POST /trpc/tasks.cancel
  cancel: dashboardProcedure.input(z.object({ taskId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { teamId } = ctx.auth
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.teamId, teamId)))
      .limit(1)

    if (!task) throw new TRPCError({ code: 'NOT_FOUND' })
    if (!['submitted', 'routing'].includes(task.status)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot cancel task in status: ${task.status}` })
    }

    await db.update(tasks).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(tasks.id, input.taskId))

    const actorId = ctx.auth.type === 'dashboard' ? ctx.auth.userId : undefined
    await writeAuditLog({
      teamId,
      ...(actorId ? { actorId } : {}),
      action: 'task.cancelled',
      resourceType: 'task',
      resourceId: input.taskId,
    })

    return { success: true }
  }),
})
