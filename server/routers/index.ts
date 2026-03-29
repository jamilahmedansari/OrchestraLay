// routers/index.ts — merge all routers into appRouter

import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from '../trpc/trpc.js'
import { tasksRouter } from './tasks.js'
import { diffsRouter } from './diffs.js'
import { dashboardRouter } from './dashboard.js'
import { authRouter } from './auth.js'

export const appRouter = createTRPCRouter({
  health: publicProcedure
    .input(z.object({ ping: z.string().optional() }).optional())
    .query(({ input }) => ({
      ok: true,
      service: 'orchestralay',
      echoedPing: input?.ping ?? null,
      now: new Date().toISOString(),
    })),

  tasks: tasksRouter,
  diffs: diffsRouter,
  dashboard: dashboardRouter,
  auth: authRouter,
})

export type AppRouter = typeof appRouter
