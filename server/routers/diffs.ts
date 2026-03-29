import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router } from '../trpc/trpc.js'
import { authedProcedure, dashboardProcedure, apiKeyProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { diffs } from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'

export const diffsRouter = router({
  getForTask: authedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(diffs.taskId, input.taskId), eq(diffs.teamId, ctx.auth.teamId)]
      if (ctx.auth.type === 'apikey') {
        conditions.push(eq(diffs.projectId, ctx.auth.projectId))
      }

      return db
        .select({
          id: diffs.id,
          filePath: diffs.filePath,
          operation: diffs.operation,
          status: diffs.status,
          linesAdded: diffs.linesAdded,
          linesRemoved: diffs.linesRemoved,
          flagged: diffs.flagged,
          blocked: diffs.blocked,
          safetyViolations: diffs.safetyViolations,
          createdAt: diffs.createdAt,
        })
        .from(diffs)
        .where(and(...conditions))
        .orderBy(desc(diffs.createdAt))
    }),

  getPendingForTeam: dashboardProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(diffs)
        .where(
          and(
            eq(diffs.teamId, ctx.auth.teamId),
            eq(diffs.status, 'pending')
          )
        )
        .orderBy(desc(diffs.createdAt))
        .limit(input.limit)
        .offset(input.offset)
    }),

  getContent: authedProcedure
    .input(z.object({ diffId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(diffs.id, input.diffId), eq(diffs.teamId, ctx.auth.teamId)]
      if (ctx.auth.type === 'apikey') {
        conditions.push(eq(diffs.projectId, ctx.auth.projectId))
      }

      const [diff] = await db
        .select()
        .from(diffs)
        .where(and(...conditions))
        .limit(1)

      if (!diff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Diff not found' })
      }

      return diff
    }),

  approve: authedProcedure
    .input(z.object({ diffId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conditions = [eq(diffs.id, input.diffId), eq(diffs.teamId, ctx.auth.teamId)]
      if (ctx.auth.type === 'apikey') {
        conditions.push(eq(diffs.projectId, ctx.auth.projectId))
      }

      const [diff] = await db
        .select()
        .from(diffs)
        .where(and(...conditions))
        .limit(1)

      if (!diff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Diff not found' })
      }

      // Blocked diffs cannot be approved via API
      if (diff.blocked) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Blocked diffs cannot be approved. Update project safety settings first.',
        })
      }

      if (diff.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot approve diff in ${diff.status} state`,
        })
      }

      await db
        .update(diffs)
        .set({ status: 'approved' })
        .where(eq(diffs.id, input.diffId))

      return { success: true }
    }),

  reject: authedProcedure
    .input(z.object({ diffId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conditions = [eq(diffs.id, input.diffId), eq(diffs.teamId, ctx.auth.teamId)]
      if (ctx.auth.type === 'apikey') {
        conditions.push(eq(diffs.projectId, ctx.auth.projectId))
      }

      const [diff] = await db
        .select()
        .from(diffs)
        .where(and(...conditions))
        .limit(1)

      if (!diff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Diff not found' })
      }

      await db
        .update(diffs)
        .set({ status: 'rejected' })
        .where(eq(diffs.id, input.diffId))

      return { success: true }
    }),

  approveAll: authedProcedure
    .input(
      z.object({
        taskId: z.string().uuid().optional(),
        skipFlagged: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const conditions = [
        eq(diffs.teamId, ctx.auth.teamId),
        eq(diffs.status, 'pending'),
        eq(diffs.blocked, false),
      ]

      if (ctx.auth.type === 'apikey') {
        conditions.push(eq(diffs.projectId, ctx.auth.projectId))
      }

      if (input.taskId) {
        conditions.push(eq(diffs.taskId, input.taskId))
      }

      if (input.skipFlagged) {
        conditions.push(eq(diffs.flagged, false))
      }

      const result = await db
        .update(diffs)
        .set({ status: 'approved' })
        .where(and(...conditions))

      return { success: true }
    }),

  markApplied: apiKeyProcedure('tasks:write')
    .input(z.object({ diffIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(diffs)
        .set({ status: 'applied', appliedAt: new Date() })
        .where(
          and(
            inArray(diffs.id, input.diffIds),
            eq(diffs.teamId, ctx.auth.teamId),
            eq(diffs.projectId, ctx.auth.projectId),
            eq(diffs.status, 'approved')
          )
        )

      return { success: true }
    }),

  revert: authedProcedure
    .input(z.object({ diffId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conditions = [eq(diffs.id, input.diffId), eq(diffs.teamId, ctx.auth.teamId)]
      if (ctx.auth.type === 'apikey') {
        conditions.push(eq(diffs.projectId, ctx.auth.projectId))
      }

      const [diff] = await db
        .select()
        .from(diffs)
        .where(and(...conditions))
        .limit(1)

      if (!diff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Diff not found' })
      }

      if (diff.status !== 'applied') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Can only revert applied diffs',
        })
      }

      await db
        .update(diffs)
        .set({ status: 'reverted' })
        .where(eq(diffs.id, input.diffId))

      return {
        success: true,
        beforeContent: diff.beforeContent,
        filePath: diff.filePath,
      }
    }),
})
