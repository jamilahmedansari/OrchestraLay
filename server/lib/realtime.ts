import { supabaseAdmin } from './supabase.js'

/**
 * Broadcast task update via Supabase Realtime channel.
 * Called by worker at each status transition.
 */
export function broadcastTaskUpdate(
  taskId: string,
  payload: Record<string, unknown>
): void {
  supabaseAdmin
    .channel(`task:${taskId}`)
    .send({
      type: 'broadcast',
      event: 'task_update',
      payload: { taskId, ...payload },
    })
    .catch(() => {})
}
