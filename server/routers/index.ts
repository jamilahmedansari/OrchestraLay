import { router } from '../trpc/trpc.js'
import { authRouter } from './auth.js'
import { tasksRouter } from './tasks.js'
import { diffsRouter } from './diffs.js'
import { dashboardRouter } from './dashboard.js'

export const appRouter = router({
  auth: authRouter,
  tasks: tasksRouter,
  diffs: diffsRouter,
  dashboard: dashboardRouter,
})

export type AppRouter = typeof appRouter
