import { TRPCError } from '@trpc/server'
import { db } from '../db/index.js'
import { rateLimitBuckets } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const PER_MINUTE_LIMIT = 30
const PER_DAY_LIMIT = 1000

/**
 * Per-API-key bucket rate limiting. Postgres-backed.
 * Throws TOO_MANY_REQUESTS with retry-after header info.
 */
export async function enforceRateLimit(keyId: string): Promise<void> {
  const now = new Date()

  // Check per-minute bucket
  await checkBucket(keyId, 'per_minute', PER_MINUTE_LIMIT, 60_000, now)

  // Check per-day bucket
  await checkBucket(keyId, 'per_day', PER_DAY_LIMIT, 86_400_000, now)
}

async function checkBucket(
  keyId: string,
  bucketType: string,
  limit: number,
  windowMs: number,
  now: Date
): Promise<void> {
  const [existing] = await db
    .select()
    .from(rateLimitBuckets)
    .where(
      and(
        eq(rateLimitBuckets.keyId, keyId),
        eq(rateLimitBuckets.bucketType, bucketType)
      )
    )
    .limit(1)

  if (!existing) {
    // Create new bucket
    await db.insert(rateLimitBuckets).values({
      keyId,
      bucketType,
      tokenCount: 1,
      windowStart: now,
    })
    return
  }

  const windowStart = new Date(existing.windowStart)
  const elapsed = now.getTime() - windowStart.getTime()

  if (elapsed > windowMs) {
    // Window expired — reset
    await db
      .update(rateLimitBuckets)
      .set({ tokenCount: 1, windowStart: now })
      .where(eq(rateLimitBuckets.id, existing.id))
    return
  }

  if (existing.tokenCount >= limit) {
    const retryAfterMs = windowMs - elapsed
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000)
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Rate limit exceeded (${bucketType}: ${limit} requests per window). Retry after ${retryAfterSeconds}s.`,
    })
  }

  // Increment counter
  await db
    .update(rateLimitBuckets)
    .set({ tokenCount: existing.tokenCount + 1 })
    .where(eq(rateLimitBuckets.id, existing.id))
}
