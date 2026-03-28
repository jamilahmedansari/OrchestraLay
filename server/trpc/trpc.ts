import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'
import type { Context } from './context.js'

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      },
    }
  },
})

export const router = t.router
export const publicProcedure = t.procedure
export const middleware = t.middleware
