// rateLimiter.ts — per-API-key bucket rate limiting

import { db } from '../db/index.js'
import { rateLimitBuckets } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'

const BUCKET_TYPE = 'minute'
const MAX_REQUESTS_PER_MINUTE = 60
const WINDOW_MS = 60_000

export async function enforceRateLimit(keyId: string): Promise<void> {
  const now = new Date()

  const [bucket] = await db
    .select()
    .from(rateLimitBuckets)
    .where(and(eq(rateLimitBuckets.keyId, keyId), eq(rateLimitBuckets.bucketType, BUCKET_TYPE)))
    .limit(1)

  if (!bucket) {
    // First request — create bucket
    await db.insert(rateLimitBuckets).values({
      keyId,
      bucketType: BUCKET_TYPE,
      tokenCount: 1,
      windowStart: now,
    })
    return
  }

  const windowAge = now.getTime() - new Date(bucket.windowStart).getTime()

  if (windowAge > WINDOW_MS) {
    // Window expired — reset
    await db
      .update(rateLimitBuckets)
      .set({ tokenCount: 1, windowStart: now })
      .where(eq(rateLimitBuckets.id, bucket.id))
    return
  }

  if (bucket.tokenCount >= MAX_REQUESTS_PER_MINUTE) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Rate limit exceeded. Max ${MAX_REQUESTS_PER_MINUTE} requests per minute.`,
    })
  }

  // Increment counter
  await db
    .update(rateLimitBuckets)
    .set({ tokenCount: bucket.tokenCount + 1 })
    .where(eq(rateLimitBuckets.id, bucket.id))
}
