// realtime.ts — broadcastTaskUpdate() via Supabase Realtime

import { supabaseAdmin } from './supabase.js'

export type TaskUpdatePayload = {
  taskId: string
  status?: string
  event?: string
  modelId?: string
  selectedModel?: string
  failedModel?: string
  nextModel?: string
  costCents?: number
  baselineCostCents?: number
  directSavingsCents?: number
  diffCount?: number
  blockedCount?: number
  flaggedCount?: number
  error?: string
  message?: string
}

export async function broadcastTaskUpdate(taskId: string, data: Omit<TaskUpdatePayload, 'taskId'>): Promise<void> {
  const payload: TaskUpdatePayload = { taskId, ...data }
  try {
    await supabaseAdmin.channel('task-updates').send({
      type: 'broadcast',
      event: 'task_update',
      payload,
    })
  } catch (err) {
    // Non-fatal — realtime is best-effort
    console.warn('[realtime] broadcast failed:', err)
  }
}
