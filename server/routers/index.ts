import { z } from 'zod'

import { createTRPCRouter, publicProcedure } from '../trpc/trpc.js'

export const appRouter = createTRPCRouter({
  health: publicProcedure
    .input(z.object({ ping: z.string().optional() }).optional())
    .query(({ input }) => ({
      ok: true,
      service: 'orchestralay',
      echoedPing: input?.ping ?? null,
      now: new Date().toISOString(),
    })),
})

export type AppRouter = typeof appRouter