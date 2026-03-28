import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import type { AppRouter } from '../../server/routers/index.js'

function getToken(): string | null {
  return localStorage.getItem('supabase_token')
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/trpc',
      transformer: superjson,
      headers() {
        const token = getToken()
        return token ? { Authorization: `Bearer ${token}` } : {}
      },
    }),
  ],
})
