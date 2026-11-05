import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const body = await request.json().catch(() => null)
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''

  if (!slug) {
    return Response.json({ event: null }, { status: 200, headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceRole) {
    return Response.json({ error: 'Server misconfigured.' }, { status: 500, headers: corsHeaders })
  }

  const supabase = createClient(url, serviceRole)
  const { data, error } = await supabase
    .from('events')
    .select('id,name,slug,status,registration_open')
    .eq('slug', slug)
    .single()

  if (error) {
    return Response.json({ event: null }, { status: 200, headers: corsHeaders })
  }

  return Response.json({ event: data }, { status: 200, headers: corsHeaders })
})
