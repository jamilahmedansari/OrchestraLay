import { initTRPC } from '@trpc/server'
import superjson from 'superjson'

import { env } from '../lib/env.js'
import type { TrpcContext } from './context.js'

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ error, shape }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        stack: env.NODE_ENV === 'production' ? undefined : error.stack,
      },
    }
  },
})

export const createTRPCRouter = t.router
export const router = t.router
export const createCallerFactory = t.createCallerFactory
export const middleware = t.middleware
export const publicProcedure = t.procedure