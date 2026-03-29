import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { appRouter } from './routers/index.js'
import { createContext } from './trpc/context.js'
import { getQueue } from './lib/queue.js'
import { startOrchestrationWorker } from './workers/orchestrateTask.js'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

// CORS — never use * with credentials
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

app.use(express.json())

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// tRPC
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req }) => createContext({ req }),
  })
)

// ── Startup order is load-bearing (Bug 3 fix) ──────────────────────
async function start() {
  // 1. Queue first
  await getQueue()

  // 2. Worker second
  await startOrchestrationWorker()

  // 3. Server last
  app.listen(PORT, () => {
    console.error(`OrchestraLay API running on port ${PORT}`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
