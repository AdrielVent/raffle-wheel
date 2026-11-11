import { createClient } from '@supabase/supabase-js'
import { isLiveBackendConfigured, supabaseAnonKey, supabaseUrl } from './env'
import { createMockSupabaseClient } from './mockBackend'

export const supabase = isLiveBackendConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // PKCE returns the magic-link result as ?code= in the query string. The implicit flow
        // uses the URL fragment, which collides with HashRouter routes on GitHub Pages.
        flowType: 'pkce',
        detectSessionInUrl: true,
      },
    })
  : createMockSupabaseClient()
