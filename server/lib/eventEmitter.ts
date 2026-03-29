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
  }).catch((err) => {
    console.warn('[eventEmitter] n8n webhook failed:', err)
  })
}
