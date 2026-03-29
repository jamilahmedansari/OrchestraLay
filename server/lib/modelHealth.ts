// modelHealth.ts — in-memory circuit breaker per model
// Tracks recent failures. If failures exceed threshold in the window, model is unhealthy.

import type { ModelId } from './modelRegistry.js'

const FAILURE_THRESHOLD = 3      // failures before circuit opens
const WINDOW_MS = 60_000 * 5    // 5-minute rolling window
const RECOVERY_MS = 60_000 * 2  // 2 minutes before retrying a tripped model

type FailureRecord = {
  timestamps: number[]
  trippedAt: number | null
}

const state = new Map<ModelId, FailureRecord>()

function getRecord(modelId: ModelId): FailureRecord {
  if (!state.has(modelId)) {
    state.set(modelId, { timestamps: [], trippedAt: null })
  }
  return state.get(modelId)!
}

export function recordFailure(modelId: ModelId): void {
  const record = getRecord(modelId)
  const now = Date.now()

  // Prune old failures outside the window
  record.timestamps = record.timestamps.filter((t) => now - t < WINDOW_MS)
  record.timestamps.push(now)

  if (record.timestamps.length >= FAILURE_THRESHOLD) {
    record.trippedAt = now
  }
}

export function recordSuccess(modelId: ModelId): void {
  const record = getRecord(modelId)
  record.timestamps = []
  record.trippedAt = null
}

export function isHealthy(modelId: ModelId): boolean {
  const record = getRecord(modelId)
  const now = Date.now()

  if (record.trippedAt !== null) {
    // Allow recovery after RECOVERY_MS
    if (now - record.trippedAt > RECOVERY_MS) {
      record.trippedAt = null
      record.timestamps = []
      return true
    }
    return false
  }

  // Prune old failures
  record.timestamps = record.timestamps.filter((t) => now - t < WINDOW_MS)
  return record.timestamps.length < FAILURE_THRESHOLD
}

export function getHealthStatus(): Record<ModelId, { healthy: boolean; recentFailures: number }> {
  const result: Record<string, { healthy: boolean; recentFailures: number }> = {}
  for (const [modelId, record] of state.entries()) {
    const now = Date.now()
    const recent = record.timestamps.filter((t) => now - t < WINDOW_MS)
    result[modelId] = {
      healthy: isHealthy(modelId),
      recentFailures: recent.length,
    }
  }
  return result as Record<ModelId, { healthy: boolean; recentFailures: number }>
}
