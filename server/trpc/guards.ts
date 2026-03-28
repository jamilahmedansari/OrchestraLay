import { TRPCError } from '@trpc/server'
import { middleware, publicProcedure } from './trpc.js'
import type { AuthContext, DashboardAuth, ApiKeyAuth } from './context.js'

// ─── Middleware: require any auth ────────────────────────────────────

const isAuthed = middleware(async ({ ctx, next }) => {
  if (ctx.auth.type === 'none') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' })
  }
  return next({ ctx: { ...ctx, auth: ctx.auth as DashboardAuth | ApiKeyAuth } })
})

// ─── Middleware: require dashboard (JWT) auth ────────────────────────

const isDashboard = middleware(async ({ ctx, next }) => {
  if (ctx.auth.type !== 'dashboard') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Dashboard authentication required' })
  }
  return next({ ctx: { ...ctx, auth: ctx.auth as DashboardAuth } })
})

// ─── Middleware: require admin role ──────────────────────────────────

const isAdmin = middleware(async ({ ctx, next }) => {
  if (ctx.auth.type !== 'dashboard') {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Dashboard authentication required' })
  }
  if (ctx.auth.role !== 'admin' && ctx.auth.role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' })
  }
  return next({ ctx: { ...ctx, auth: ctx.auth as DashboardAuth } })
})

// ─── Middleware factory: require API key with specific scope ─────────

function requireApiKeyScope(scope: string) {
  return middleware(async ({ ctx, next }) => {
    if (ctx.auth.type !== 'apikey') {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'API key required' })
    }
    if (!ctx.auth.scopes.includes(scope)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `Scope '${scope}' required` })
    }
    return next({ ctx: { ...ctx, auth: ctx.auth as ApiKeyAuth } })
  })
}

// ─── Procedure variants ──────────────────────────────────────────────

export const authedProcedure = publicProcedure.use(isAuthed)
export const dashboardProcedure = publicProcedure.use(isDashboard)
export const adminProcedure = publicProcedure.use(isAdmin)

export function apiKeyProcedure(scope: string) {
  return publicProcedure.use(requireApiKeyScope(scope))
}

// Re-export publicProcedure for convenience
export { publicProcedure } from './trpc.js'
