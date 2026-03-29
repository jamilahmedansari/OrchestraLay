// diffs.ts — diff review workflow, 8 procedures

import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter } from '../trpc/trpc.js'
import { dashboardProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { diffs, tasks } from '../db/schema.js'
import { writeAuditLog } from '../lib/audit.js'

export const diffsRouter = createTRPCRouter({
  // List all pending diffs for the team
  listPending: dashboardProcedure.input(
    z.object({
      projectId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }),
  ).query(async ({ ctx, input }) => {
    const { teamId } = ctx.auth

    const rows = await db
      .select({ diff: diffs, taskId: tasks.id, taskType: tasks.taskType })
      .from(diffs)
      .innerJoin(tasks, eq(tasks.id, diffs.taskId))
      .where(
        and(
          eq(tasks.teamId, teamId),
          eq(diffs.status, 'pending'),
          input.projectId ? eq(diffs.projectId, input.projectId) : undefined,
        ),
      )
      .limit(input.limit)
      .offset(input.offset)

    return rows
  }),

  // Get diffs for a specific task
  forTask: dashboardProcedure.input(z.object({ taskId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { teamId } = ctx.auth

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.teamId, teamId)))
      .limit(1)

    if (!task) throw new TRPCError({ code: 'NOT_FOUND' })

    return db.select().from(diffs).where(eq(diffs.taskId, input.taskId))
  }),

  // Get single diff
  get: dashboardProcedure.input(z.object({ diffId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { teamId } = ctx.auth

    const [row] = await db
      .select({ diff: diffs, task: tasks })
      .from(diffs)
      .innerJoin(tasks, eq(tasks.id, diffs.taskId))
      .where(and(eq(diffs.id, input.diffId), eq(tasks.teamId, teamId)))
      .limit(1)

    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
    return row
  }),

  // Approve a diff
  approve: dashboardProcedure.input(z.object({ diffId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { teamId, userId } = ctx.auth

    const [row] = await db
      .select({ diff: diffs, task: tasks })
      .from(diffs)
      .innerJoin(tasks, eq(tasks.id, diffs.taskId))
      .where(and(eq(diffs.id, input.diffId), eq(tasks.teamId, teamId)))
      .limit(1)

    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
    if (row.diff.status === 'blocked') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Diff is blocked by safety rules. Change project settings first.' })
    }

    await db.update(diffs).set({ status: 'approved', approvedAt: new Date(), approvedByUserId: userId }).where(eq(diffs.id, input.diffId))
    await writeAuditLog({
      teamId,
      actorId: userId,
      action: 'diff.approved',
      resourceType: 'diff',
      resourceId: input.diffId,
      metadata: { filePath: row.diff.filePath },
    })

    return { success: true }
  }),

  // Reject a diff
  reject: dashboardProcedure.input(
    z.object({ diffId: z.string().uuid(), reason: z.string().optional() }),
  ).mutation(async ({ ctx, input }) => {
    const { teamId, userId } = ctx.auth

    const [row] = await db
      .select({ diff: diffs, task: tasks })
      .from(diffs)
      .innerJoin(tasks, eq(tasks.id, diffs.taskId))
      .where(and(eq(diffs.id, input.diffId), eq(tasks.teamId, teamId)))
      .limit(1)

    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

    await db.update(diffs).set({ status: 'rejected', rejectedAt: new Date(), rejectedByUserId: userId }).where(eq(diffs.id, input.diffId))
    await writeAuditLog({
      teamId,
      actorId: userId,
      action: 'diff.rejected',
      resourceType: 'diff',
      resourceId: input.diffId,
      metadata: { filePath: row.diff.filePath, reason: input.reason },
    })

    return { success: true }
  }),

  // Mark diff as applied (called by CLI after writing to disk)
  markApplied: dashboardProcedure.input(z.object({ diffId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { teamId, userId } = ctx.auth

    const [row] = await db
      .select({ diff: diffs, task: tasks })
      .from(diffs)
      .innerJoin(tasks, eq(tasks.id, diffs.taskId))
      .where(and(eq(diffs.id, input.diffId), eq(tasks.teamId, teamId)))
      .limit(1)

    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
    if (row.diff.status !== 'approved') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Diff must be approved before it can be applied' })
    }

    await db.update(diffs).set({ status: 'applied', appliedAt: new Date() }).where(eq(diffs.id, input.diffId))
    await writeAuditLog({
      teamId,
      actorId: userId,
      action: 'diff.applied',
      resourceType: 'diff',
      resourceId: input.diffId,
    })

    return { success: true }
  }),

  // Mark diff as reverted
  markReverted: dashboardProcedure.input(z.object({ diffId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { teamId, userId } = ctx.auth

    const [row] = await db
      .select({ diff: diffs, task: tasks })
      .from(diffs)
      .innerJoin(tasks, eq(tasks.id, diffs.taskId))
      .where(and(eq(diffs.id, input.diffId), eq(tasks.teamId, teamId)))
      .limit(1)

    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

    await db.update(diffs).set({ status: 'reverted' }).where(eq(diffs.id, input.diffId))
    await writeAuditLog({
      teamId,
      actorId: userId,
      action: 'diff.reverted',
      resourceType: 'diff',
      resourceId: input.diffId,
    })

    return { success: true }
  }),

  // Approve all pending diffs for a task at once
  approveAll: dashboardProcedure.input(z.object({ taskId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { teamId, userId } = ctx.auth

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.teamId, teamId)))
      .limit(1)

    if (!task) throw new TRPCError({ code: 'NOT_FOUND' })

    const pendingDiffs = await db
      .select()
      .from(diffs)
      .where(and(eq(diffs.taskId, input.taskId), eq(diffs.status, 'pending')))

    const blockedCount = pendingDiffs.filter((d) => d.status === 'blocked').length
    if (blockedCount > 0) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `${blockedCount} diffs are blocked. Resolve safety issues first.` })
    }

    await db
      .update(diffs)
      .set({ status: 'approved', approvedAt: new Date(), approvedByUserId: userId })
      .where(and(eq(diffs.taskId, input.taskId), eq(diffs.status, 'pending')))

    return { approved: pendingDiffs.length }
  }),
})
