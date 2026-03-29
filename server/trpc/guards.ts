import { TRPCError } from '@trpc/server'

import type { ApiKeyAuth, DashboardAuth } from './context.js'
import { middleware, publicProcedure } from './trpc.js'

const requireAuthed = middleware(({ ctx, next }) => {
  if (ctx.auth.type === 'none') {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  return next({
    ctx: {
      ...ctx,
      auth: ctx.auth,
    },
  })
})

const requireDashboard = middleware(({ ctx, next }) => {
  if (ctx.auth.type !== 'dashboard') {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  return next({
    ctx: {
      ...ctx,
      auth: ctx.auth satisfies DashboardAuth,
    },
  })
})

const requireAdmin = middleware(({ ctx, next }) => {
  if (ctx.auth.type !== 'dashboard' || !['owner', 'admin'].includes(ctx.auth.role)) {
    throw new TRPCError({ code: 'FORBIDDEN' })
  }

  return next({
    ctx: {
      ...ctx,
      auth: ctx.auth satisfies DashboardAuth,
    },
  })
})

export const authedProcedure = publicProcedure.use(requireAuthed)
export const dashboardProcedure = publicProcedure.use(requireAuthed).use(requireDashboard)
export const adminProcedure = publicProcedure.use(requireAuthed).use(requireDashboard).use(requireAdmin)

export function apiKeyProcedure(scope: string) {
  return publicProcedure.use(requireAuthed).use(({ ctx, next }) => {
    if (ctx.auth.type !== 'apikey') {
      throw new TRPCError({ code: 'UNAUTHORIZED' })
    }

    const auth = ctx.auth satisfies ApiKeyAuth
    if (!auth.scopes.includes(scope)) {
      throw new TRPCError({ code: 'FORBIDDEN' })
    }

    return next({
      ctx: {
        ...ctx,
        auth,
      },
    })
  })
}

export { publicProcedure }