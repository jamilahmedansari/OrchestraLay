import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required')
}

const client = new Pool({
  connectionString,
  max: process.env.NODE_ENV === 'production' ? 20 : 10,
})

export const db = drizzle(client, { schema })
export type Database = typeof db
