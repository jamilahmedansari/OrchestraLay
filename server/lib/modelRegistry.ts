export type ModelId =
  | 'claude-3-5-sonnet'
  | 'claude-3-haiku'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'perplexity-sonar-pro'
  | 'perplexity-sonar'

export type Provider = 'anthropic' | 'openai' | 'perplexity'

export type TaskType = 'code_generation' | 'debugging' | 'refactoring' | 'analysis' | 'review'

export interface ModelSpec {
  id: ModelId
  provider: Provider
  inputCentsPer1M: number
  outputCentsPer1M: number
  strengths: TaskType[]
  maxConcurrentRequests: number
  timeoutSeconds: number
  avgOutputTokens: Record<TaskType, number>
}

export const MODEL_REGISTRY: Record<ModelId, ModelSpec> = {
  'claude-3-5-sonnet': {
    id: 'claude-3-5-sonnet',
    provider: 'anthropic',
    inputCentsPer1M: 300,
    outputCentsPer1M: 1500,
    strengths: ['code_generation', 'refactoring', 'review'],
    maxConcurrentRequests: 10,
    timeoutSeconds: 120,
    avgOutputTokens: {
      code_generation: 2000,
      debugging: 1500,
      refactoring: 2000,
      analysis: 1200,
      review: 1000,
    },
  },
  'claude-3-haiku': {
    id: 'claude-3-haiku',
    provider: 'anthropic',
    inputCentsPer1M: 25,
    outputCentsPer1M: 125,
    strengths: ['debugging', 'analysis'],
    maxConcurrentRequests: 20,
    timeoutSeconds: 60,
    avgOutputTokens: {
      code_generation: 1500,
      debugging: 1000,
      refactoring: 1500,
      analysis: 800,
      review: 600,
    },
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    inputCentsPer1M: 250,
    outputCentsPer1M: 1000,
    strengths: ['analysis', 'review', 'debugging'],
    maxConcurrentRequests: 10,
    timeoutSeconds: 120,
    avgOutputTokens: {
      code_generation: 2000,
      debugging: 1500,
      refactoring: 2000,
      analysis: 1200,
      review: 1000,
    },
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    inputCentsPer1M: 15,
    outputCentsPer1M: 60,
    strengths: ['analysis'],
    maxConcurrentRequests: 30,
    timeoutSeconds: 60,
    avgOutputTokens: {
      code_generation: 1500,
      debugging: 1000,
      refactoring: 1500,
      analysis: 800,
      review: 600,
    },
  },
  'perplexity-sonar-pro': {
    id: 'perplexity-sonar-pro',
    provider: 'perplexity',
    inputCentsPer1M: 300,
    outputCentsPer1M: 1500,
    strengths: ['analysis'],
    maxConcurrentRequests: 5,
    timeoutSeconds: 120,
    avgOutputTokens: {
      code_generation: 1500,
      debugging: 1200,
      refactoring: 1500,
      analysis: 1500,
      review: 1000,
    },
  },
  'perplexity-sonar': {
    id: 'perplexity-sonar',
    provider: 'perplexity',
    inputCentsPer1M: 80,
    outputCentsPer1M: 80,
    strengths: ['analysis'],
    maxConcurrentRequests: 10,
    timeoutSeconds: 60,
    avgOutputTokens: {
      code_generation: 1000,
      debugging: 800,
      refactoring: 1000,
      analysis: 1000,
      review: 600,
    },
  },
}

/** Default ranking per task type — first is best */
export const DEFAULT_MODEL_RANKING: Record<TaskType, ModelId[]> = {
  code_generation: ['claude-3-5-sonnet', 'gpt-4o', 'claude-3-haiku', 'gpt-4o-mini', 'perplexity-sonar-pro', 'perplexity-sonar'],
  debugging: ['claude-3-haiku', 'gpt-4o', 'claude-3-5-sonnet', 'gpt-4o-mini', 'perplexity-sonar-pro', 'perplexity-sonar'],
  refactoring: ['claude-3-5-sonnet', 'gpt-4o', 'claude-3-haiku', 'gpt-4o-mini', 'perplexity-sonar-pro', 'perplexity-sonar'],
  analysis: ['gpt-4o', 'perplexity-sonar-pro', 'claude-3-5-sonnet', 'claude-3-haiku', 'gpt-4o-mini', 'perplexity-sonar'],
  review: ['claude-3-5-sonnet', 'gpt-4o', 'claude-3-haiku', 'gpt-4o-mini', 'perplexity-sonar-pro', 'perplexity-sonar'],
}

/** Estimate cost in integer cents using avg output tokens for task type */
export function estimateCostCents(modelId: ModelId, taskType: TaskType, promptTokens: number): number {
  const spec = MODEL_REGISTRY[modelId]
  const avgOutput = spec.avgOutputTokens[taskType]
  const inputCost = (promptTokens / 1_000_000) * spec.inputCentsPer1M
  const outputCost = (avgOutput / 1_000_000) * spec.outputCentsPer1M
  return Math.ceil(inputCost + outputCost)
}

/** Calculate actual cost from real token counts — integer cents */
export function calculateActualCost(modelId: ModelId, promptTokens: number, completionTokens: number): number {
  const spec = MODEL_REGISTRY[modelId]
  const inputCost = (promptTokens / 1_000_000) * spec.inputCentsPer1M
  const outputCost = (completionTokens / 1_000_000) * spec.outputCentsPer1M
  return Math.ceil(inputCost + outputCost)
}
