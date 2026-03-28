import { randomBytes, createHash } from 'node:crypto'

export function generateApiKey(): string {
  return `olay_${randomBytes(32).toString('hex')}`
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}
