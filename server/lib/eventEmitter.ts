// eventEmitter.ts — fire-and-forget POST to n8n webhook on task events

import { env } from './env.js'

export type TaskEvent = {
  taskId: string
  status: string
  teamId: string
  projectId: string
  modelId?: string
  costCents?: number
  error?: string
  metadata?: Record<string, unknown>
}

export function emitTaskEvent(event: TaskEvent): void {
  if (!env.N8N_WEBHOOK_URL) return

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.N8N_WEBHOOK_SECRET) {
    headers['x-webhook-secret'] = env.N8N_WEBHOOK_SECRET
  }

  fetch(env.N8N_WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...event, emittedAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(3000),
  }).catch((err) => {
    console.warn('[eventEmitter] n8n webhook failed:', err)
  })
}

/** Convenience wrapper matching orchestrateTask call convention: emitEvent('task.completed', { ... }) */
export function emitEvent(type: string, data: Record<string, unknown>): void {
  const event: TaskEvent = {
    taskId: data.taskId as string,
    status: type,
    teamId: data.teamId as string,
    projectId: data.projectId as string,
  }
  if (data.model || data.modelId) event.modelId = (data.model ?? data.modelId) as string
  if (data.costCents != null) event.costCents = data.costCents as number
  if (data.error != null) event.error = data.error as string
  if (data.metadata != null) event.metadata = data.metadata as Record<string, unknown>
  emitTaskEvent(event)
}
