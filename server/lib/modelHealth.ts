import type { ModelId } from './modelRegistry.js'

interface CircuitState {
  failures: number
  lastFailure: number
  isOpen: boolean
}

const FAILURE_THRESHOLD = 3
const COOLDOWN_MS = 60_000

const circuits = new Map<ModelId, CircuitState>()

function getState(modelId: ModelId): CircuitState {
  let state = circuits.get(modelId)
  if (!state) {
    state = { failures: 0, lastFailure: 0, isOpen: false }
    circuits.set(modelId, state)
  }
  return state
}

export function recordSuccess(modelId: ModelId, _latencyMs: number): void {
  const state = getState(modelId)
  state.failures = 0
  state.isOpen = false
}

export function recordFailure(modelId: ModelId): void {
  const state = getState(modelId)
  state.failures++
  state.lastFailure = Date.now()
  if (state.failures >= FAILURE_THRESHOLD) {
    state.isOpen = true
  }
}

export function isModelAvailable(modelId: ModelId): boolean {
  const state = getState(modelId)
  if (!state.isOpen) return true

  if (Date.now() - state.lastFailure > COOLDOWN_MS) {
    state.isOpen = false
    state.failures = 0
    return true
  }

  return false
}
