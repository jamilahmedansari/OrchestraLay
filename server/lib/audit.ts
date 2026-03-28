import { db } from '../db/index.js'
import { auditLogs } from '../db/schema.js'

interface AuditEntry {
  userId?: string
  teamId?: string
  action: string
  resource: string
  resourceId?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
}

export function writeAuditLog(entry: AuditEntry): void {
  db.insert(auditLogs)
    .values(entry)
    .execute()
    .catch(() => {})
}
