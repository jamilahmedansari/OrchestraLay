import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient | null {
	if (supabaseClient) {
		return supabaseClient
	}

	const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
	const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
	if (!supabaseUrl || !supabaseAnonKey) {
		return null
	}

	supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
		},
	})

	return supabaseClient
}
