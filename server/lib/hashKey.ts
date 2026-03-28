import { randomBytes, createHash } from 'crypto'

/**
 * Generate a new API key with the olay_ prefix.
 * Returns { raw, hash, prefix } — show raw exactly once, store hash only.
 */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `olay_${randomBytes(32).toString('hex')}`
  const hash = hashApiKey(raw)
  const prefix = raw.slice(0, 12)
  return { raw, hash, prefix }
}

/** SHA-256 hash — not bcrypt. API keys are high-entropy; speed matters. */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
