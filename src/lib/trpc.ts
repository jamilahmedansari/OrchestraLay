import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '../../server/routers/index.js'

export const trpc = createTRPCReact<AppRouter>()

export function resolveTrpcUrl(): string {
	const configured = import.meta.env.VITE_TRPC_URL
	const url = configured ? new URL(configured, window.location.origin) : new URL('/trpc', window.location.origin)
	const teamId = new URLSearchParams(window.location.search).get('teamId')

	if (teamId) {
		url.searchParams.set('teamId', teamId)
	}

	return url.toString()
}

export function getStoredAuthToken(): string | null {
	return window.localStorage.getItem('orchestralay.auth.token')
}
