import PgBoss from 'pg-boss'

let boss: PgBoss | null = null

export async function getQueue(): Promise<PgBoss> {
  if (boss) return boss

  boss = new PgBoss(process.env.DATABASE_URL!)
  await boss.start()
  return boss
}
