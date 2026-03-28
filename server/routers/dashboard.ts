import { z } from 'zod'
import { router } from '../trpc/trpc.js'
import { dashboardProcedure } from '../trpc/guards.js'
import { db } from '../db/index.js'
import { tasks, diffs, costLogs, teams } from '../db/schema.js'
import { eq, and, desc, gte, sql, count } from 'drizzle-orm'

export const dashboardRouter = router({
  getOverview: dashboardProcedure.query(async ({ ctx }) => {
    const teamId = ctx.auth.teamId
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // 4 metric cards in parallel
    const [
      tasksToday,
      costToday,
      pendingDiffs,
      failedToday,
      recentTasks,
      teamData,
    ] = await Promise.all([
      // Tasks today
      db
        .select({ count: count() })
        .from(tasks)
        .where(and(eq(tasks.teamId, teamId), gte(tasks.createdAt, todayStart))),

      // Cost today
      db
        .select({ total: sql<number>`COALESCE(SUM(${costLogs.costCents}), 0)` })
        .from(costLogs)
        .where(and(eq(costLogs.teamId, teamId), gte(costLogs.createdAt, todayStart))),

      // Pending diffs
      db
        .select({ count: count() })
        .from(diffs)
        .where(and(eq(diffs.teamId, teamId), eq(diffs.status, 'pending'))),

      // Failed today
      db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.teamId, teamId),
            eq(tasks.status, 'failed'),
            gte(tasks.createdAt, todayStart)
          )
        ),

      // Recent tasks (live feed)
      db
        .select({
          id: tasks.id,
          prompt: tasks.prompt,
          taskType: tasks.taskType,
          status: tasks.status,
          selectedModel: tasks.selectedModel,
          actualCostCents: tasks.actualCostCents,
          createdAt: tasks.createdAt,
        })
        .from(tasks)
        .where(eq(tasks.teamId, teamId))
        .orderBy(desc(tasks.createdAt))
        .limit(50),

      // Team data for budget
      db.select().from(teams).where(eq(teams.id, teamId)).limit(1),
    ])

    return {
      metrics: {
        tasksToday: tasksToday[0]?.count ?? 0,
        costTodayCents: Number(costToday[0]?.total ?? 0),
        pendingDiffs: pendingDiffs[0]?.count ?? 0,
        failedToday: failedToday[0]?.count ?? 0,
      },
      recentTasks,
      team: teamData[0] ?? null,
    }
  }),

  getCosts: dashboardProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(30).default(7),
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = ctx.auth.teamId
      const since = new Date()
      since.setDate(since.getDate() - input.days)

      // Daily breakdown by model (for stacked bar chart)
      const dailyCosts = await db
        .select({
          date: sql<string>`DATE(${costLogs.createdAt})`.as('date'),
          modelName: costLogs.modelName,
          provider: costLogs.provider,
          totalCostCents: sql<number>`SUM(${costLogs.costCents})`.as('total_cost'),
          totalTokens: sql<number>`SUM(${costLogs.promptTokens} + ${costLogs.completionTokens})`.as('total_tokens'),
          requestCount: count().as('request_count'),
        })
        .from(costLogs)
        .where(and(eq(costLogs.teamId, teamId), gte(costLogs.createdAt, since)))
        .groupBy(sql`DATE(${costLogs.createdAt})`, costLogs.modelName, costLogs.provider)
        .orderBy(sql`DATE(${costLogs.createdAt})`)

      // Model breakdown totals
      const modelBreakdown = await db
        .select({
          modelName: costLogs.modelName,
          provider: costLogs.provider,
          totalCostCents: sql<number>`SUM(${costLogs.costCents})`.as('total_cost'),
          totalTokens: sql<number>`SUM(${costLogs.promptTokens} + ${costLogs.completionTokens})`.as('total_tokens'),
          requestCount: count().as('request_count'),
        })
        .from(costLogs)
        .where(and(eq(costLogs.teamId, teamId), gte(costLogs.createdAt, since)))
        .groupBy(costLogs.modelName, costLogs.provider)

      // Month-to-date total
      const billingPeriod = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
      const [monthTotal] = await db
        .select({
          totalCostCents: sql<number>`COALESCE(SUM(${costLogs.costCents}), 0)`,
        })
        .from(costLogs)
        .where(
          and(
            eq(costLogs.teamId, teamId),
            eq(costLogs.billingPeriod, billingPeriod)
          )
        )

      // Team budget
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)

      return {
        dailyCosts,
        modelBreakdown,
        monthToDateCents: Number(monthTotal?.totalCostCents ?? 0),
        budgetCents: team?.monthlyBudgetCents ?? 0,
        billingPeriod,
      }
    }),
})
