// dashboard.ts — aggregated metrics: getOverview + getCosts

import { z } from 'zod'
import { eq, and, gte, desc, sql, count, sum, avg } from 'drizzle-orm'
import { createTRPCRouter } from '../trpc/trpc.js'
import { dashboardProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { tasks, modelResults, teams } from '../db/schema.js'

export const dashboardRouter = createTRPCRouter({
  getOverview: dashboardProcedure.query(async ({ ctx }) => {
    const { teamId } = ctx.auth

    // Recent tasks — last 50
    const recentTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.teamId, teamId))
      .orderBy(desc(tasks.createdAt))
      .limit(50)

    // Status breakdown
    const statusCounts = await db
      .select({ status: tasks.status, count: count() })
      .from(tasks)
      .where(eq(tasks.teamId, teamId))
      .groupBy(tasks.status)

    // Team budget
    const [team] = await db
      .select({ budget: teams.monthlyBudgetCents, spent: teams.currentMonthSpendCents })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)

    return {
      recentTasks,
      statusBreakdown: statusCounts,
      budget: team ?? { budget: 0, spent: 0 },
    }
  }),

  getCosts: dashboardProcedure.input(
    z.object({ days: z.number().int().min(1).max(90).default(7) }),
  ).query(async ({ ctx, input }) => {
    const { teamId } = ctx.auth
    const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)

    // Cost by model
    const byModel = await db
      .select({
        modelId: modelResults.modelId,
        totalCostCents: sum(modelResults.costCents),
        totalInputTokens: sum(modelResults.inputTokens),
        totalOutputTokens: sum(modelResults.outputTokens),
        callCount: count(),
        avgDurationMs: avg(modelResults.durationMs),
      })
      .from(modelResults)
      .innerJoin(tasks, eq(tasks.id, modelResults.taskId))
      .where(
        and(
          eq(tasks.teamId, teamId),
          eq(modelResults.status, 'success'),
          gte(modelResults.createdAt, since),
        ),
      )
      .groupBy(modelResults.modelId)
      .orderBy(desc(sum(modelResults.costCents)))

    // Daily spend
    const dailySpend = await db
      .select({
        day: sql<string>`DATE(${modelResults.createdAt})`.as('day'),
        totalCostCents: sum(modelResults.costCents),
        taskCount: count(),
      })
      .from(modelResults)
      .innerJoin(tasks, eq(tasks.id, modelResults.taskId))
      .where(
        and(
          eq(tasks.teamId, teamId),
          eq(modelResults.status, 'success'),
          gte(modelResults.createdAt, since),
        ),
      )
      .groupBy(sql`DATE(${modelResults.createdAt})`)
      .orderBy(sql`DATE(${modelResults.createdAt})`)

    // Month-to-date total
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [mtd] = await db
      .select({ totalCostCents: sum(modelResults.costCents) })
      .from(modelResults)
      .innerJoin(tasks, eq(tasks.id, modelResults.taskId))
      .where(
        and(
          eq(tasks.teamId, teamId),
          eq(modelResults.status, 'success'),
          gte(modelResults.createdAt, monthStart),
        ),
      )

    const [team] = await db
      .select({ budget: teams.monthlyBudgetCents })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)

    return {
      byModel,
      dailySpend,
      monthToDateCents: Number(mtd?.totalCostCents ?? 0),
      monthlyBudgetCents: team?.budget ?? 0,
    }
  }),
})
