import { db } from '../db/index.js'
import { auditLogs } from '../db/schema.js'

export interface AuditEntry {
  teamId?: string
  userId?: string
  action: string
  resource: string
  resourceId?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
}

/** Insert audit log entry. Always fire-and-forget — never await in hot path. */
export function writeAuditLog(entry: AuditEntry): void {
  db.insert(auditLogs)
    .values({
      teamId: entry.teamId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ?? null,
      ipAddress: entry.ipAddress ?? null,
    })
    .execute()
    .catch(() => {})
}
