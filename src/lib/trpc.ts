import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import type { AppRouter } from '../../server/routers/index.js'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export function getToken(): string {
  return localStorage.getItem('olay_token') ?? ''
}

export function setToken(token: string) {
  localStorage.setItem('olay_token', token)
}

export function clearToken() {
  localStorage.removeItem('olay_token')
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      transformer: superjson,
      headers() {
        const token = getToken()
        return token ? { Authorization: `Bearer ${token}` } : {}
      },
    }),
  ],
})
