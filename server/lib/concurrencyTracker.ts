// concurrencyTracker.ts — in-memory active request counter per model

import type { ModelId } from './modelRegistry.js'

const counters = new Map<ModelId, number>()

export function incrementConcurrency(modelId: ModelId): void {
  counters.set(modelId, (counters.get(modelId) ?? 0) + 1)
}

export function decrementConcurrency(modelId: ModelId): void {
  const current = counters.get(modelId) ?? 0
  counters.set(modelId, Math.max(0, current - 1))
}

export function getActiveConcurrency(modelId: ModelId): number {
  return counters.get(modelId) ?? 0
}
