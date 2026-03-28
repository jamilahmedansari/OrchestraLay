import { TRPCError } from '@trpc/server'
import { middleware, publicProcedure } from './trpc.js'
import type { DashboardAuth, ApiKeyAuth } from './context.js'

const isAuthed = middleware(async ({ ctx, next }) => {
  if (ctx.auth.type === 'none') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' })
  }
  return next({ ctx: { ...ctx, auth: ctx.auth as DashboardAuth | ApiKeyAuth } })
})

const isDashboard = middleware(async ({ ctx, next }) => {
  if (ctx.auth.type !== 'dashboard') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Dashboard access required' })
  }
  return next({ ctx: { ...ctx, auth: ctx.auth as DashboardAuth } })
})

const isAdmin = middleware(async ({ ctx, next }) => {
  if (ctx.auth.type !== 'dashboard' || ctx.auth.role !== 'admin') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Admin access required' })
  }
  return next({ ctx: { ...ctx, auth: ctx.auth as DashboardAuth } })
})

export const authedProcedure = publicProcedure.use(isAuthed)
export const dashboardProcedure = publicProcedure.use(isDashboard)
export const adminProcedure = publicProcedure.use(isAdmin)

export function apiKeyProcedure(requiredScope: string) {
  return publicProcedure.use(
    middleware(async ({ ctx, next }) => {
      if (ctx.auth.type !== 'apikey') {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'API key required' })
      }
      if (!ctx.auth.scopes.includes(requiredScope)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: `Missing scope: ${requiredScope}` })
      }
      return next({ ctx: { ...ctx, auth: ctx.auth as ApiKeyAuth } })
    })
  )
}
