import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body = await request.json().catch(() => null)
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''

  if (!slug) {
    return Response.json({ event: null }, { status: 200 })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceRole) {
    return Response.json({ error: 'Server misconfigured.' }, { status: 500 })
  }

  const supabase = createClient(url, serviceRole)
  const { data, error } = await supabase
    .from('events')
    .select('id,name,slug,status,registration_open')
    .eq('slug', slug)
    .single()

  if (error) {
    return Response.json({ event: null }, { status: 200 })
  }

  return Response.json({ event: data }, { status: 200 })
})
