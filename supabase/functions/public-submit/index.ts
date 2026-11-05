import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const namePattern = /^[\p{L}\p{M}](?:[\p{L}\p{M}\s'\-]{0,98}[\p{L}\p{M}])?$/u

function normalizeName(value: string) {
  return value.trim()
}

function hashFingerprint(input: string) {
  const bytes = new TextEncoder().encode(input)
  return crypto.subtle.digest('SHA-256', bytes).then((digest) => {
    const chars = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    return chars.join('')
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body = await request.json().catch(() => null)

  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  const firstName = typeof body?.firstName === 'string' ? normalizeName(body.firstName) : ''
  const lastName = typeof body?.lastName === 'string' ? normalizeName(body.lastName) : ''
  const submissionId = typeof body?.submissionId === 'string' ? body.submissionId : ''
  const retryReceipt = typeof body?.retryReceipt === 'string' ? body.retryReceipt : ''

  if (!slug || !submissionId || !retryReceipt) {
    return Response.json({ status: 'invalid_event' }, { status: 400 })
  }

  if (!namePattern.test(firstName) || !namePattern.test(lastName)) {
    return Response.json({ status: 'invalid_name' }, { status: 400 })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceRole) {
    return Response.json({ status: 'invalid_event' }, { status: 500 })
  }

  const supabase = createClient(url, serviceRole)

  const { data: event } = await supabase
    .from('events')
    .select('id,status,registration_open')
    .eq('slug', slug)
    .maybeSingle()

  if (!event) {
    return Response.json({ status: 'invalid_event' }, { status: 404 })
  }

  if (event.status === 'ended') {
    return Response.json({ status: 'ended' }, { status: 200 })
  }

  if (event.status !== 'open' || !event.registration_open) {
    return Response.json({ status: 'closed' }, { status: 200 })
  }

  const fingerprint = await hashFingerprint(
    `${request.headers.get('x-forwarded-for') ?? 'unknown'}|${request.headers.get('user-agent') ?? 'unknown'}`,
  )

  const { data: canProceed } = await supabase.rpc('apply_rate_limit', {
    p_event_id: event.id,
    p_fingerprint_hash: fingerprint,
    p_limit: 10,
  })

  if (!canProceed) {
    return Response.json({ status: 'rate_limited' }, { status: 429 })
  }

  const insertPayload = {
    event_id: event.id,
    first_name: firstName,
    last_name: lastName,
    submission_id: submissionId,
    retry_receipt: retryReceipt,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('entries')
    .insert(insertPayload)
    .select('id,retry_receipt')
    .maybeSingle()

  if (!insertError && inserted) {
    return Response.json({ status: 'accepted', entry_id: inserted.id, receipt_id: inserted.retry_receipt }, { status: 200 })
  }

  const { data: existing } = await supabase
    .from('entries')
    .select('id,retry_receipt')
    .eq('event_id', event.id)
    .eq('submission_id', submissionId)
    .maybeSingle()

  if (existing) {
    return Response.json({ status: 'duplicate', entry_id: existing.id, receipt_id: existing.retry_receipt }, { status: 200 })
  }

  return Response.json({ status: 'invalid_event' }, { status: 500 })
})
