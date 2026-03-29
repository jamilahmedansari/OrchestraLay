import type { Config } from 'drizzle-kit'

import { env } from './server/lib/env.js'

export default {
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
} satisfies Config