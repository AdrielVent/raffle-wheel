import { createClient } from '@supabase/supabase-js'
import { isLiveBackendConfigured, supabaseAnonKey, supabaseUrl } from './env'
import { createMockSupabaseClient } from './mockBackend'

export const supabase = isLiveBackendConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : createMockSupabaseClient()
