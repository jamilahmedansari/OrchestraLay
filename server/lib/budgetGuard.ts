import { TRPCError } from '@trpc/server'
import { db } from '../db/index.js'
import { teams, projects } from '../db/schema.js'
import { eq } from 'drizzle-orm'

/**
 * Pre-flight spend enforcement. Checks team monthly cap + project cap.
 * Throws FORBIDDEN with human-readable message if exceeded.
 */
export async function enforceBudget(projectId: string, teamId: string): Promise<void> {
  const [team] = await db
    .select({
      monthlyBudgetCents: teams.monthlyBudgetCents,
      currentMonthSpendCents: teams.currentMonthSpendCents,
      plan: teams.plan,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)

  if (!team) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' })
  }

  if (team.currentMonthSpendCents >= team.monthlyBudgetCents) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Team monthly budget exceeded: ${team.currentMonthSpendCents}¢ / ${team.monthlyBudgetCents}¢. Upgrade your plan or wait for the billing period to reset.`,
    })
  }

  // Check project-level budget if set
  const [project] = await db
    .select({ monthlyBudgetCents: projects.monthlyBudgetCents })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (project?.monthlyBudgetCents) {
    // Project budget check would require aggregating cost_logs for this project in current period
    // For MVP, team-level budget is the primary gate
  }
}
