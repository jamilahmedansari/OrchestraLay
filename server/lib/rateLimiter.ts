import { TRPCError } from '@trpc/server'
import { db } from '../db/index.js'
import { rateLimitBuckets } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const PER_MINUTE_LIMIT = 30
const PER_DAY_LIMIT = 1000

async function getOrCreateBucket(
  keyId: string,
  bucketType: 'per_minute' | 'per_day'
): Promise<{ tokenCount: number; windowStart: Date; id: string }> {
  const existing = await db.query.rateLimitBuckets.findFirst({
    where: and(
      eq(rateLimitBuckets.keyId, keyId),
      eq(rateLimitBuckets.bucketType, bucketType)
    ),
  })

  if (existing) return existing

  const [created] = await db
    .insert(rateLimitBuckets)
    .values({ keyId, bucketType, tokenCount: 0, windowStart: new Date() })
    .onConflictDoNothing()
    .returning()

  if (created) return created

  const refetched = await db.query.rateLimitBuckets.findFirst({
    where: and(
      eq(rateLimitBuckets.keyId, keyId),
      eq(rateLimitBuckets.bucketType, bucketType)
    ),
  })

  return refetched!
}

function getWindowMs(bucketType: 'per_minute' | 'per_day'): number {
  return bucketType === 'per_minute' ? 60_000 : 86_400_000
}

export async function enforceRateLimit(keyId: string): Promise<void> {
  const bucketTypes = ['per_minute', 'per_day'] as const

  for (const bucketType of bucketTypes) {
    const bucket = await getOrCreateBucket(keyId, bucketType)
    const windowMs = getWindowMs(bucketType)
    const now = new Date()
    const elapsed = now.getTime() - bucket.windowStart.getTime()

    if (elapsed > windowMs) {
      await db
        .update(rateLimitBuckets)
        .set({ tokenCount: 1, windowStart: now })
        .where(eq(rateLimitBuckets.id, bucket.id))

      continue
    }

    const limit = bucketType === 'per_minute' ? PER_MINUTE_LIMIT : PER_DAY_LIMIT

    if (bucket.tokenCount >= limit) {
      const retryAfterMs = windowMs - elapsed
      const retryAfterSec = Math.ceil(retryAfterMs / 1000)
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Rate limit exceeded (${bucketType}). Retry after ${retryAfterSec}s.`,
      })
    }

    await db
      .update(rateLimitBuckets)
      .set({ tokenCount: bucket.tokenCount + 1 })
      .where(eq(rateLimitBuckets.id, bucket.id))
  }
}
