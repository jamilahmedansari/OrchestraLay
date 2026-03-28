import { z } from 'zod'
import { router } from '../trpc/trpc.js'
import { dashboardProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { tasks, diffs, costLogs, teams } from '../db/schema.js'
import { eq, and, gte, sql, count, desc } from 'drizzle-orm'

export const dashboardRouter = router({
  getOverview: dashboardProcedure.query(async ({ ctx }) => {
    const teamId = ctx.auth.teamId
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [taskStats] = await db
      .select({
        total: count(),
        todayCount: sql<number>`count(*) filter (where ${tasks.createdAt} >= ${todayStart})`,
        failedToday: sql<number>`count(*) filter (where ${tasks.status} = 'failed' and ${tasks.createdAt} >= ${todayStart})`,
      })
      .from(tasks)
      .where(eq(tasks.teamId, teamId))

    const [costToday] = await db
      .select({
        totalCents: sql<number>`coalesce(sum(${costLogs.costCents}), 0)`,
      })
      .from(costLogs)
      .where(and(eq(costLogs.teamId, teamId), gte(costLogs.createdAt, todayStart)))

    const [pendingDiffs] = await db
      .select({ count: count() })
      .from(diffs)
      .innerJoin(tasks, eq(diffs.taskId, tasks.id))
      .where(and(eq(tasks.teamId, teamId), eq(diffs.status, 'pending')))

    const recentTasks = await db.query.tasks.findMany({
      where: eq(tasks.teamId, teamId),
      orderBy: [desc(tasks.createdAt)],
      limit: 20,
      columns: {
        id: true,
        prompt: true,
        taskType: true,
        status: true,
        selectedModel: true,
        actualCostCents: true,
        createdAt: true,
      },
    })

    return {
      tasksToday: Number(taskStats.todayCount),
      costTodayCents: Number(costToday.totalCents),
      pendingDiffs: pendingDiffs.count,
      failedToday: Number(taskStats.failedToday),
      recentTasks,
    }
  }),

  getCosts: dashboardProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(90).default(7),
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = ctx.auth.teamId
      const since = new Date()
      since.setDate(since.getDate() - input.days)

      const team = await db.query.teams.findFirst({
        where: eq(teams.id, teamId),
        columns: {
          monthlyBudgetCents: true,
          currentMonthSpendCents: true,
          billingPeriod: true,
        },
      })

      const dailyCosts = await db
        .select({
          date: sql<string>`date(${costLogs.createdAt})`.as('date'),
          modelName: costLogs.modelName,
          totalCents: sql<number>`sum(${costLogs.costCents})`.as('total_cents'),
          totalTokens: sql<number>`sum(${costLogs.promptTokens} + ${costLogs.completionTokens})`.as(
            'total_tokens'
          ),
          requestCount: count(),
        })
        .from(costLogs)
        .where(and(eq(costLogs.teamId, teamId), gte(costLogs.createdAt, since)))
        .groupBy(sql`date(${costLogs.createdAt})`, costLogs.modelName)
        .orderBy(sql`date(${costLogs.createdAt})`)

      const modelBreakdown = await db
        .select({
          modelName: costLogs.modelName,
          provider: costLogs.provider,
          totalCents: sql<number>`sum(${costLogs.costCents})`.as('total_cents'),
          totalTokens: sql<number>`sum(${costLogs.promptTokens} + ${costLogs.completionTokens})`.as(
            'total_tokens'
          ),
          requestCount: count(),
        })
        .from(costLogs)
        .where(and(eq(costLogs.teamId, teamId), gte(costLogs.createdAt, since)))
        .groupBy(costLogs.modelName, costLogs.provider)

      return {
        budget: team
          ? {
              monthlyBudgetCents: team.monthlyBudgetCents,
              currentSpendCents: team.currentMonthSpendCents,
              billingPeriod: team.billingPeriod,
            }
          : null,
        dailyCosts,
        modelBreakdown,
      }
    }),
})
