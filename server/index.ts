import express from 'express'
import cors from 'cors'
import { createExpressMiddleware } from '@trpc/server/adapters/express'

import { env, getAllowedOrigins } from './lib/env.js'
import { getQueue } from './lib/queue.js'
import { appRouter } from './routers/index.js'
import { createContext } from './trpc/context.js'
import { startOrchestrationWorker } from './workers/orchestrateTask.js'

async function bootstrap(): Promise<void> {
  const app = express()

  app.use(
    cors({
      origin: getAllowedOrigins(),
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '2mb' }))

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true })
  })

  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  )

  await getQueue()
  await startOrchestrationWorker()

  app.listen(env.PORT, () => {})
}

bootstrap().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})