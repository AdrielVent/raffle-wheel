import { createClient } from '@supabase/supabase-js'
import { isBackendConfigured, supabaseAnonKey, supabaseUrl } from './env'

export const supabase = isBackendConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
