import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from '../lib/env.js'
import * as schema from './schema.js'

const globalForDb = globalThis as typeof globalThis & {
  orchestralayPool?: Pool
}

const pool =
  globalForDb.orchestralayPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: env.NODE_ENV === 'production' ? 20 : 10,
  })

if (env.NODE_ENV !== 'production') {
  globalForDb.orchestralayPool = pool
}

export const db = drizzle(pool, { schema })
export { pool }