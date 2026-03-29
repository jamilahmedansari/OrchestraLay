// budgetGuard.ts — pre-flight spend enforcement

import { db } from '../db/index.js'
import { eq, sql } from 'drizzle-orm'
import { teams } from '../db/schema.js'
import { TRPCError } from '@trpc/server'

export async function assertBudget(teamId: string, estimatedCostCents: number): Promise<void> {
  const rows = await db
    .select({
      budget: teams.monthlyBudgetCents,
      spent: teams.currentMonthSpendCents,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)

  const team = rows[0]
  if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' })
  if (team.budget === 0) return // unlimited

  const remaining = team.budget - team.spent
  if (estimatedCostCents > remaining) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Monthly budget exceeded. Remaining: ${remaining}¢, estimated cost: ${estimatedCostCents}¢`,
    })
  }
}

export async function incrementSpend(teamId: string, costCents: number): Promise<void> {
  // Atomic increment — raw SQL to avoid race conditions
  await db.execute(
    sql`UPDATE teams SET current_month_spend_cents = current_month_spend_cents + ${costCents} WHERE id = ${teamId}`,
  )
}
