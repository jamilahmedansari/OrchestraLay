import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
if (!supabaseUrl) throw new Error('SUPABASE_URL is required')

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')

const anonKey = process.env.SUPABASE_ANON_KEY
if (!anonKey) throw new Error('SUPABASE_ANON_KEY is required')

/** Server-only admin client — never expose to frontend */
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Anon client for JWT validation and Realtime */
export const supabaseAnon = createClient(supabaseUrl, anonKey)
