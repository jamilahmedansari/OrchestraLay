export type ModelId =
  | 'claude-3-5-sonnet'
  | 'claude-3-haiku'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'perplexity-sonar-pro'
  | 'perplexity-sonar'

export type Provider = 'anthropic' | 'openai' | 'perplexity'

export type TaskType =
  | 'code_generation'
  | 'debugging'
  | 'refactoring'
  | 'analysis'
  | 'review'

export interface ModelSpec {
  id: ModelId
  provider: Provider
  inputCostCentsPer1M: number
  outputCostCentsPer1M: number
  strengths: TaskType[]
  maxConcurrentRequests: number
  avgOutputTokens: Record<TaskType, number>
}

export const MODEL_REGISTRY: Record<ModelId, ModelSpec> = {
  'claude-3-5-sonnet': {
    id: 'claude-3-5-sonnet',
    provider: 'anthropic',
    inputCostCentsPer1M: 300,
    outputCostCentsPer1M: 1500,
    strengths: ['code_generation', 'refactoring', 'review'],
    maxConcurrentRequests: 10,
    avgOutputTokens: {
      code_generation: 2000,
      debugging: 1500,
      refactoring: 2500,
      analysis: 1000,
      review: 1200,
    },
  },
  'claude-3-haiku': {
    id: 'claude-3-haiku',
    provider: 'anthropic',
    inputCostCentsPer1M: 25,
    outputCostCentsPer1M: 125,
    strengths: ['debugging', 'analysis'],
    maxConcurrentRequests: 20,
    avgOutputTokens: {
      code_generation: 1500,
      debugging: 1200,
      refactoring: 1800,
      analysis: 800,
      review: 1000,
    },
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    inputCostCentsPer1M: 250,
    outputCostCentsPer1M: 1000,
    strengths: ['analysis', 'review', 'debugging'],
    maxConcurrentRequests: 10,
    avgOutputTokens: {
      code_generation: 2000,
      debugging: 1500,
      refactoring: 2000,
      analysis: 1000,
      review: 1200,
    },
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    inputCostCentsPer1M: 15,
    outputCostCentsPer1M: 60,
    strengths: ['analysis'],
    maxConcurrentRequests: 30,
    avgOutputTokens: {
      code_generation: 1500,
      debugging: 1000,
      refactoring: 1500,
      analysis: 800,
      review: 800,
    },
  },
  'perplexity-sonar-pro': {
    id: 'perplexity-sonar-pro',
    provider: 'perplexity',
    inputCostCentsPer1M: 300,
    outputCostCentsPer1M: 1500,
    strengths: ['analysis'],
    maxConcurrentRequests: 5,
    avgOutputTokens: {
      code_generation: 1500,
      debugging: 1000,
      refactoring: 1500,
      analysis: 1200,
      review: 1000,
    },
  },
  'perplexity-sonar': {
    id: 'perplexity-sonar',
    provider: 'perplexity',
    inputCostCentsPer1M: 80,
    outputCostCentsPer1M: 80,
    strengths: ['analysis'],
    maxConcurrentRequests: 10,
    avgOutputTokens: {
      code_generation: 1000,
      debugging: 800,
      refactoring: 1200,
      analysis: 800,
      review: 600,
    },
  },
}

export const DEFAULT_MODEL_RANKING: Record<TaskType, ModelId[]> = {
  code_generation: ['claude-3-5-sonnet', 'gpt-4o', 'claude-3-haiku', 'gpt-4o-mini', 'perplexity-sonar-pro', 'perplexity-sonar'],
  debugging: ['claude-3-haiku', 'gpt-4o', 'claude-3-5-sonnet', 'gpt-4o-mini', 'perplexity-sonar-pro', 'perplexity-sonar'],
  refactoring: ['claude-3-5-sonnet', 'gpt-4o', 'claude-3-haiku', 'gpt-4o-mini', 'perplexity-sonar-pro', 'perplexity-sonar'],
  analysis: ['gpt-4o', 'perplexity-sonar-pro', 'claude-3-5-sonnet', 'claude-3-haiku', 'gpt-4o-mini', 'perplexity-sonar'],
  review: ['claude-3-5-sonnet', 'gpt-4o', 'claude-3-haiku', 'gpt-4o-mini', 'perplexity-sonar-pro', 'perplexity-sonar'],
}

export function estimateCostCents(
  modelId: ModelId,
  taskType: TaskType,
  promptTokens: number
): number {
  const spec = MODEL_REGISTRY[modelId]
  const avgOutput = spec.avgOutputTokens[taskType]
  const inputCost = (promptTokens / 1_000_000) * spec.inputCostCentsPer1M
  const outputCost = (avgOutput / 1_000_000) * spec.outputCostCentsPer1M
  return Math.ceil(inputCost + outputCost)
}
