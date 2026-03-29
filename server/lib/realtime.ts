// realtime.ts — broadcastTaskUpdate() via Supabase Realtime

import { supabaseAdmin } from './supabase.js'

export type TaskUpdatePayload = {
  taskId: string
  status: string
  modelId?: string
  costCents?: number
  error?: string
}

export async function broadcastTaskUpdate(payload: TaskUpdatePayload): Promise<void> {
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
