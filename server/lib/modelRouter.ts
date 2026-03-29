import { db } from '../db/index.js'
import { costLogs } from '../db/schema.js'
import { eq, gte, sql } from 'drizzle-orm'
import {
  type ModelId,
  type TaskType,
  MODEL_REGISTRY,
  DEFAULT_MODEL_RANKING,
  estimateCostCents,
  getBaselineModel,
  isModelId,
} from './modelRegistry.js'
import { isModelAvailable } from './modelHealth.js'

export interface RouterDecision {
  selectedModel: ModelId
  estimatedCostCents: number
  baselineModel: ModelId
  baselineCostCents: number
  reasoning: string[]
  fallbackChain: ModelId[]
}

export interface ResolveModelInput {
  taskType: TaskType
  promptTokens: number
  budgetCents?: number
  preferredModels?: string[]
}

/** 6-gate decision engine */
export async function resolveModel(input: ResolveModelInput): Promise<RouterDecision> {
  const reasoning: string[] = []
  const baselineModel = getBaselineModel(input.taskType)
  const baselineCostCents = estimateCostCents(baselineModel, input.taskType, input.promptTokens)

  // Gate 1 — Preference
  let candidates: ModelId[]
  if (input.preferredModels?.length) {
    const valid = input.preferredModels.filter(
      (m): m is ModelId => isModelId(m)
    )
    if (valid.length > 0) {
      candidates = valid
      reasoning.push(`Gate 1: Using preferred models: ${valid.join(', ')}`)
    } else {
      candidates = [...DEFAULT_MODEL_RANKING[input.taskType]]
      reasoning.push(`Gate 1: Preferred models invalid, using defaults for ${input.taskType}`)
    }
  } else {
    candidates = [...DEFAULT_MODEL_RANKING[input.taskType]]
    reasoning.push(`Gate 1: Using default ranking for ${input.taskType}`)
  }

  // Gate 2 — Budget
  if (input.budgetCents !== undefined) {
    const affordable = candidates.filter(
      (m) => estimateCostCents(m, input.taskType, input.promptTokens) <= input.budgetCents!
    )
    if (affordable.length > 0) {
      candidates = affordable
      reasoning.push(`Gate 2: ${affordable.length} models within budget of ${input.budgetCents}¢`)
    } else {
      // Keep cheapest anyway — never fully block on budget
      candidates = [candidates.reduce((a, b) =>
        estimateCostCents(a, input.taskType, input.promptTokens) <
        estimateCostCents(b, input.taskType, input.promptTokens) ? a : b
      )]
      reasoning.push(`Gate 2: All over budget, keeping cheapest: ${candidates[0]}`)
    }
  } else {
    reasoning.push('Gate 2: No budget constraint')
  }

  // Gate 3 — Health
  const healthy = candidates.filter((m) => isModelAvailable(m))
  if (healthy.length > 0) {
    candidates = healthy
    reasoning.push(`Gate 3: ${healthy.length} healthy models`)
  } else {
    // Proceed with first anyway — fail gracefully, not silently
    reasoning.push(`Gate 3: All circuits open, proceeding with ${candidates[0]}`)
  }

  // Gate 4 — Concurrency
  const oneMinuteAgo = new Date(Date.now() - 60_000)
  const activeCounts = await db
    .select({
      modelName: costLogs.modelName,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(costLogs)
    .where(gte(costLogs.createdAt, oneMinuteAgo))
    .groupBy(costLogs.modelName)

  const countMap = new Map(activeCounts.map((r) => [r.modelName, Number(r.count)]))

  const available = candidates.filter((m) => {
    const spec = MODEL_REGISTRY[m]
    const active = countMap.get(m) ?? 0
    return active < spec.maxConcurrentRequests
  })

  if (available.length > 0) {
    candidates = available
    reasoning.push(`Gate 4: ${available.length} models under concurrency limit`)
  } else {
    reasoning.push(`Gate 4: All at capacity, proceeding with ${candidates[0]}`)
  }

  // Gate 5 — Select first remaining
  const selected = candidates[0]
  reasoning.push(`Gate 5: Selected ${selected}`)

  // Gate 6 — Return with fallback chain
  const fallbackChain = candidates.slice(1)
  const estimated = estimateCostCents(selected, input.taskType, input.promptTokens)

  return {
    selectedModel: selected,
    estimatedCostCents: estimated,
    baselineModel,
    baselineCostCents,
    reasoning,
    fallbackChain,
  }
}

/** Iterate fallback chain for retry after failure */
export function resolveFailover(
  failedModel: ModelId,
  fallbackChain: ModelId[],
  taskType: TaskType,
  promptTokens: number,
  budgetCents?: number
): ModelId | null {
  for (const candidate of fallbackChain) {
    if (candidate === failedModel) continue
    if (!isModelAvailable(candidate)) continue
    if (budgetCents !== undefined) {
      const cost = estimateCostCents(candidate, taskType, promptTokens)
      if (cost > budgetCents) continue
    }
    return candidate
  }
  return null
}
