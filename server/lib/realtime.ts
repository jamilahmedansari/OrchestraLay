import { supabaseAdmin } from './supabase.js'

export async function broadcastTaskUpdate(
  taskId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await supabaseAdmin.channel(`task:${taskId}`).send({
    type: 'broadcast',
    event: 'task_update',
    payload: { taskId, ...payload },
  })
}
