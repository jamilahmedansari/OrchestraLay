// audit.ts — writeAuditLog() for all significant actions

import { db } from '../db/index.js'
import { auditLogs } from '../db/schema.js'

export type AuditAction =
  | 'task.submitted'
  | 'task.routing'
  | 'task.executing'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'diff.approved'
  | 'diff.rejected'
  | 'diff.applied'
  | 'diff.reverted'
  | 'apikey.created'
  | 'apikey.revoked'
  | 'budget.exceeded'

export async function writeAuditLog(params: {
  teamId: string
  actorId?: string
  action: AuditAction
  resource: string
  resourceId: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      teamId: params.teamId,
      userId: params.actorId ?? null,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      metadata: params.metadata ?? {},
    })
  } catch (err) {
    // Audit log failure is non-fatal
    console.error('[audit] failed to write audit log:', err)
  }
}
