import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router } from '../trpc/trpc.js'
import { authedProcedure, dashboardProcedure, apiKeyProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { diffs, tasks } from '../db/schema.js'
import { eq, and, inArray } from 'drizzle-orm'
import { writeAuditLog } from '../lib/audit.js'

function getTeamId(auth: { type: string; teamId: string }): string {
  return auth.teamId
}

export const diffsRouter = router({
  getForTask: authedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const teamId = getTeamId(ctx.auth)

      const task = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.taskId), eq(tasks.teamId, teamId)),
      })

      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' })
      }

      return db.query.diffs.findMany({
        where: eq(diffs.taskId, input.taskId),
        columns: {
          id: true,
          filePath: true,
          operation: true,
          linesAdded: true,
          linesRemoved: true,
          status: true,
          flagged: true,
          blocked: true,
          safetyViolations: true,
          applied: true,
          createdAt: true,
        },
      })
    }),

  getPendingForTeam: dashboardProcedure.query(async ({ ctx }) => {
    const teamTasks = await db.query.tasks.findMany({
      where: eq(tasks.teamId, ctx.auth.teamId),
      columns: { id: true },
    })

    if (teamTasks.length === 0) return []

    const taskIds = teamTasks.map((t) => t.id)

    return db.query.diffs.findMany({
      where: and(
        inArray(diffs.taskId, taskIds),
        eq(diffs.status, 'pending')
      ),
      columns: {
        id: true,
        taskId: true,
        filePath: true,
        operation: true,
        linesAdded: true,
        linesRemoved: true,
        flagged: true,
        blocked: true,
        safetyViolations: true,
        createdAt: true,
      },
    })
  }),

  getContent: authedProcedure
    .input(z.object({ diffId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const teamId = getTeamId(ctx.auth)

      const diff = await db.query.diffs.findFirst({
        where: eq(diffs.id, input.diffId),
        with: { task: { columns: { teamId: true } } },
      })

      if (!diff || diff.task.teamId !== teamId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Diff not found' })
      }

      return {
        id: diff.id,
        filePath: diff.filePath,
        operation: diff.operation,
        beforeContent: diff.beforeContent,
        afterContent: diff.afterContent,
        hunks: diff.hunks,
        linesAdded: diff.linesAdded,
        linesRemoved: diff.linesRemoved,
        safetyViolations: diff.safetyViolations,
      }
    }),

  approve: authedProcedure
    .input(z.object({ diffId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const teamId = getTeamId(ctx.auth)

      const diff = await db.query.diffs.findFirst({
        where: eq(diffs.id, input.diffId),
        with: { task: { columns: { teamId: true } } },
      })

      if (!diff || diff.task.teamId !== teamId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Diff not found' })
      }

      if (diff.blocked) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Blocked diffs cannot be approved. Update project safety settings first.',
        })
      }

      await db
        .update(diffs)
        .set({ status: 'approved' })
        .where(eq(diffs.id, input.diffId))

      writeAuditLog({
        teamId,
        action: 'diff.approved',
        resource: 'diff',
        resourceId: input.diffId,
      })

      return { success: true }
    }),

  reject: authedProcedure
    .input(z.object({ diffId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const teamId = getTeamId(ctx.auth)

      const diff = await db.query.diffs.findFirst({
        where: eq(diffs.id, input.diffId),
        with: { task: { columns: { teamId: true } } },
      })

      if (!diff || diff.task.teamId !== teamId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Diff not found' })
      }

      await db
        .update(diffs)
        .set({ status: 'rejected' })
        .where(eq(diffs.id, input.diffId))

      writeAuditLog({
        teamId,
        action: 'diff.rejected',
        resource: 'diff',
        resourceId: input.diffId,
      })

      return { success: true }
    }),

  approveAll: authedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        skipFlagged: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = getTeamId(ctx.auth)

      const task = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, input.taskId), eq(tasks.teamId, teamId)),
      })

      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' })
      }

      const pendingDiffs = await db.query.diffs.findMany({
        where: and(
          eq(diffs.taskId, input.taskId),
          eq(diffs.status, 'pending'),
          eq(diffs.blocked, false)
        ),
      })

      const toApprove = input.skipFlagged
        ? pendingDiffs.filter((d) => !d.flagged)
        : pendingDiffs

      if (toApprove.length > 0) {
        await db
          .update(diffs)
          .set({ status: 'approved' })
          .where(
            inArray(
              diffs.id,
              toApprove.map((d) => d.id)
            )
          )
      }

      return { approved: toApprove.length }
    }),

  markApplied: apiKeyProcedure('tasks:write')
    .input(z.object({ diffIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(diffs)
        .set({ applied: true, appliedAt: new Date() })
        .where(inArray(diffs.id, input.diffIds))

      return { applied: input.diffIds.length }
    }),

  revert: authedProcedure
    .input(z.object({ diffId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const teamId = getTeamId(ctx.auth)

      const diff = await db.query.diffs.findFirst({
        where: eq(diffs.id, input.diffId),
        with: { task: { columns: { teamId: true } } },
      })

      if (!diff || diff.task.teamId !== teamId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Diff not found' })
      }

      await db
        .update(diffs)
        .set({ applied: false, appliedAt: null, status: 'pending' })
        .where(eq(diffs.id, input.diffId))

      return {
        beforeContent: diff.beforeContent,
        filePath: diff.filePath,
      }
    }),
})
