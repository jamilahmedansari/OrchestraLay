// modelRouter.ts — 6-gate decision engine
// Gates: Preference → Budget → Health → Concurrency → Select → Fallback

import { db } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { teams } from '../db/schema.js'
import { ALL_MODELS, type ModelId, type ModelSpec, type TaskType } from './modelRegistry.js'
import { isHealthy } from './modelHealth.js'
import { getActiveConcurrency } from './concurrencyTracker.js'

export type RoutingDecision = {
  model: ModelSpec
  reasoning: string[]
}

type RouterInput = {
  taskType: TaskType
  teamId: string
  estimatedInputTokens: number
  preferredModel?: ModelId | undefined
}

export async function resolveModel(input: RouterInput): Promise<RoutingDecision> {
  const { taskType, teamId, estimatedInputTokens, preferredModel } = input
  const reasoning: string[] = []

  // Fetch team budget
  const teamRows = await db
    .select({
      monthlyBudgetCents: teams.monthlyBudgetCents,
      currentMonthSpendCents: teams.currentMonthSpendCents,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)

  const team = teamRows[0]
  const remainingBudgetCents = team
    ? team.monthlyBudgetCents - team.currentMonthSpendCents
    : Infinity

  // Gate 1: Preference
  let candidates = [...ALL_MODELS]
  if (preferredModel) {
    const preferred = candidates.find((m) => m.id === preferredModel)
    if (preferred) {
      candidates = [preferred, ...candidates.filter((m) => m.id !== preferredModel)]
      reasoning.push(`Gate 1 (Preference): ${preferredModel} requested, moved to front`)
    } else {
      reasoning.push(`Gate 1 (Preference): ${preferredModel} not found, using defaults`)
    }
  } else {
    reasoning.push(`Gate 1 (Preference): no preference, using task-type rankings for ${taskType}`)
    candidates.sort((a, b) => a.rankings[taskType] - b.rankings[taskType])
  }

  // Gate 2: Budget — estimate min cost and filter models that would bust budget
  const filtered: ModelSpec[] = []
  for (const model of candidates) {
    // Estimate min cost: input tokens only (conservative)
    const estimatedCostCents = Math.ceil((estimatedInputTokens / 1000) * model.inputCostPer1k * 100)
    if (remainingBudgetCents === Infinity || estimatedCostCents <= remainingBudgetCents) {
      filtered.push(model)
    } else {
      reasoning.push(`Gate 2 (Budget): ${model.id} excluded — estimated ${estimatedCostCents}¢ > ${remainingBudgetCents}¢ remaining`)
    }
  }
  if (filtered.length === 0) {
    throw new Error('BUDGET_EXCEEDED: No models within remaining monthly budget')
  }
  reasoning.push(`Gate 2 (Budget): ${filtered.length} models within budget`)

  // Gate 3: Health
  const healthy = filtered.filter((m) => {
    const ok = isHealthy(m.id)
    if (!ok) reasoning.push(`Gate 3 (Health): ${m.id} is unhealthy, skipping`)
    return ok
  })
  if (healthy.length === 0) {
    reasoning.push('Gate 3 (Health): all candidates unhealthy — falling back to full list')
    healthy.push(...filtered) // degraded mode: use unhealthy models rather than fail
  } else {
    reasoning.push(`Gate 3 (Health): ${healthy.length} healthy models`)
  }

  // Gate 4: Concurrency
  const available = healthy.filter((m) => {
    const active = getActiveConcurrency(m.id)
    const ok = active < m.maxConcurrent
    if (!ok) reasoning.push(`Gate 4 (Concurrency): ${m.id} at limit (${active}/${m.maxConcurrent})`)
    return ok
  })
  if (available.length === 0) {
    reasoning.push('Gate 4 (Concurrency): all at limit — using least loaded')
    available.push(
      healthy.reduce((best, m) => {
        const bLoad = getActiveConcurrency(best.id) / best.maxConcurrent
        const mLoad = getActiveConcurrency(m.id) / m.maxConcurrent
        return mLoad < bLoad ? m : best
      }),
    )
  } else {
    reasoning.push(`Gate 4 (Concurrency): ${available.length} models available`)
  }

  // Gate 5: Select — first candidate wins (already sorted by ranking/preference)
  const selected = available[0]
  if (!selected) {
    throw new Error('ROUTING_ERROR: No models available after all filters')
  }
  reasoning.push(`Gate 5 (Select): ${selected.id} selected`)

  return { model: selected, reasoning }
}

export async function resolveFailover(
  excludeModelId: ModelId,
  input: Omit<RouterInput, 'preferredModel'> & { preferredModel?: ModelId },
): Promise<RoutingDecision | null> {
  try {
    const result = await resolveModel({
      taskType: input.taskType,
      teamId: input.teamId,
      estimatedInputTokens: input.estimatedInputTokens,
      // omit preferredModel to ignore preference for failover
    })
    // If same model selected again, no failover available
    if (result.model.id === excludeModelId) return null
    result.reasoning.unshift(`Failover: excluded ${excludeModelId}`)
    return result
  } catch {
    return null
  }
}
