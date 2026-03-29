import PgBoss from 'pg-boss'

import { env } from './env.js'

const globalForQueue = globalThis as typeof globalThis & {
  orchestralayQueue?: PgBoss
}

export async function getQueue(): Promise<PgBoss> {
  if (!globalForQueue.orchestralayQueue) {
    const queue = new PgBoss({
      connectionString: env.DATABASE_URL,
      application_name: 'orchestralay',
    })

    await queue.start()
    globalForQueue.orchestralayQueue = queue
  }

  return globalForQueue.orchestralayQueue
}