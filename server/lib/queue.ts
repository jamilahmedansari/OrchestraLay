import PgBoss from 'pg-boss'

let boss: PgBoss | null = null

/** pg-boss singleton. Call once at startup before worker registration. */
export async function getQueue(): Promise<PgBoss> {
  if (boss) return boss

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for pg-boss')

  boss = new PgBoss({ connectionString })
  await boss.start()
  return boss
}
