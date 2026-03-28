import { db } from '../db/index.js'
import { costLogs } from '../db/schema.js'
import { eq, gte, sql } from 'drizzle-orm'
import {
  type ModelId,
  type TaskType,
  MODEL_REGISTRY,
  DEFAULT_MODEL_RANKING,
  estimateCostCents,
} from './modelRegistry.js'
import { isModelAvailable } from './modelHealth.js'

export interface RouterInput {
  taskType: TaskType
  promptTokens: number
  budgetCents?: number
  preferredModels?: string[]
}

export interface RouterDecision {
  selectedModel: ModelId
  estimatedCostCents: number
  reasoning: string[]
  fallbackChain: ModelId[]
}

export async function resolveModel(input: RouterInput): Promise<RouterDecision> {
  const reasoning: string[] = []

  // Gate 1 — Preference
  let candidates: ModelId[]
  if (input.preferredModels?.length) {
    const valid = input.preferredModels.filter(
      (m): m is ModelId => m in MODEL_REGISTRY
    )
    if (valid.length > 0) {
      candidates = valid
      reasoning.push(`Gate 1: Using preferred models: ${valid.join(', ')}`)
    } else {
      candidates = [...DEFAULT_MODEL_RANKING[input.taskType]]
      reasoning.push(`Gate 1: Preferred models invalid, using default ranking for ${input.taskType}`)
    }
  } else {
    candidates = [...DEFAULT_MODEL_RANKING[input.taskType]]
    reasoning.push(`Gate 1: Using default ranking for ${input.taskType}`)
  }

  // Gate 2 — Budget
  if (input.budgetCents != null) {
    const withinBudget = candidates.filter(
      (m) => estimateCostCents(m, input.taskType, input.promptTokens) <= input.budgetCents!
    )
    if (withinBudget.length > 0) {
      candidates = withinBudget
      reasoning.push(`Gate 2: ${withinBudget.length} models within budget of ${input.budgetCents}¢`)
    } else {
      const cheapest = candidates.reduce((a, b) =>
        estimateCostCents(a, input.taskType, input.promptTokens) <
        estimateCostCents(b, input.taskType, input.promptTokens)
          ? a
          : b
      )
      candidates = [cheapest]
      reasoning.push(`Gate 2: All models exceed budget, keeping cheapest: ${cheapest}`)
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
    reasoning.push('Gate 3: All models circuit-open, proceeding with first candidate')
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

  const underLimit = candidates.filter((m) => {
    const current = countMap.get(m) ?? 0
    return current < MODEL_REGISTRY[m].maxConcurrentRequests
  })

  if (underLimit.length > 0) {
    candidates = underLimit
    reasoning.push(`Gate 4: ${underLimit.length} models under concurrency limit`)
  } else {
    reasoning.push('Gate 4: All models at concurrency limit, proceeding with first candidate')
  }

  // Gate 5 — Select
  const selectedModel = candidates[0]
  reasoning.push(`Gate 5: Selected ${selectedModel}`)

  // Gate 6 — Return
  const estimated = estimateCostCents(selectedModel, input.taskType, input.promptTokens)
  const fallbackChain = candidates.slice(1)

  return {
    selectedModel,
    estimatedCostCents: estimated,
    reasoning,
    fallbackChain,
  }
}

export function resolveFailover(
  failedModel: ModelId,
  fallbackChain: ModelId[],
  taskType: TaskType,
  promptTokens: number,
  budgetCents?: number
): ModelId | null {
  for (const model of fallbackChain) {
    if (model === failedModel) continue
    if (!isModelAvailable(model)) continue
    if (
      budgetCents != null &&
      estimateCostCents(model, taskType, promptTokens) > budgetCents
    ) {
      continue
    }
    return model
  }
  return null
}
