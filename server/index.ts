import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createExpressMiddleware } from '@trpc/server/adapters/express'

import { env, getAllowedOrigins } from './lib/env.js'
import { getQueue } from './lib/queue.js'
import { appRouter } from './routers/index.js'
import { createContext } from './trpc/context.js'
import { startOrchestrationWorker } from './workers/orchestrateTask.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function bootstrap(): Promise<void> {
  const app = express()

  app.use(
    cors({
      origin: getAllowedOrigins(),
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '2mb' }))

  // Health check
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, service: 'orchestralay', env: env.NODE_ENV })
  })

  // tRPC API
  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  )

  // Serve compiled Vite frontend in production
  if (env.NODE_ENV === 'production') {
    const clientDist = path.resolve(__dirname, '../../client')
    app.use(express.static(clientDist))
    // SPA fallback — all non-API routes → index.html
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'))
    })
  }

  await getQueue()
  await startOrchestrationWorker()

  app.listen(env.PORT, () => {
    console.log(`[orchestralay] listening on port ${env.PORT} (${env.NODE_ENV})`)
  })
}

bootstrap().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
