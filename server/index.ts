import express from 'express'
import cors from 'cors'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { appRouter } from './routers/index.js'
import { createContext } from './trpc/context.js'
import { getQueue } from './lib/queue.js'
import { startOrchestrationWorker } from './workers/orchestrateTask.js'

const PORT = parseInt(process.env.PORT ?? '3001', 10)
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())

const app = express()

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
)

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req }) => createContext({ req }),
  })
)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

async function start() {
  await getQueue()
  await startOrchestrationWorker()

  app.listen(PORT, () => {
    console.error(`Server running on port ${PORT}`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
