import { TRPCError } from '@trpc/server'
import { db } from '../db/index.js'
import { teams, projects } from '../db/schema.js'
import { eq } from 'drizzle-orm'

export async function enforceBudget(
  projectId: string,
  teamId: string
): Promise<void> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
  })

  if (!team) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' })
  }

  if (team.currentMonthSpendCents >= team.monthlyBudgetCents) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Monthly budget exceeded. Spent ${team.currentMonthSpendCents}¢ of ${team.monthlyBudgetCents}¢ limit for ${team.billingPeriod}.`,
    })
  }
}
