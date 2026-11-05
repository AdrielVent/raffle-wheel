import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const namePattern = /^[\p{L}\p{M}](?:[\p{L}\p{M}\s'-]{0,98}[\p{L}\p{M}])?$/u
const hofstraDomain = 'hofstra.edu'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function normalizeName(value: string) {
  return value.trim()
}

function normalizeHofstraUsername(raw: string) {
  const trimmed = raw.trim()

  if (!trimmed || /\s/.test(trimmed)) {
    return { ok: false as const }
  }

  const atCount = (trimmed.match(/@/g) ?? []).length
  if (atCount > 1) {
    return { ok: false as const }
  }

  let username = trimmed

  if (atCount === 1) {
    const [candidateUsername, candidateDomain] = trimmed.split('@')

    if (!candidateUsername || !candidateDomain) {
      return { ok: false as const }
    }

    if (candidateDomain.toLocaleLowerCase() !== hofstraDomain) {
      return { ok: false as const }
    }

    username = candidateUsername
  }

  const normalizedUsername = username.trim().toLocaleLowerCase()

  if (!normalizedUsername || normalizedUsername.includes('@') || /\s/.test(normalizedUsername)) {
    return { ok: false as const }
  }

  return {
    ok: true as const,
    email: `${normalizedUsername}@${hofstraDomain}`,
  }
}

function hashFingerprint(input: string) {
  const bytes = new TextEncoder().encode(input)
  return crypto.subtle.digest('SHA-256', bytes).then((digest) => {
    const chars = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    return chars.join('')
  })
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
  const firstName = typeof body?.firstName === 'string' ? normalizeName(body.firstName) : ''
  const lastName = typeof body?.lastName === 'string' ? normalizeName(body.lastName) : ''
  const hofstraUsername = typeof body?.hofstraUsername === 'string' ? body.hofstraUsername : ''
  const submissionId = typeof body?.submissionId === 'string' ? body.submissionId : ''
  const retryReceipt = typeof body?.retryReceipt === 'string' ? body.retryReceipt : ''

  if (!slug || !submissionId || !retryReceipt) {
    return Response.json({ status: 'invalid_event' }, { status: 400, headers: corsHeaders })
  }

  if (!namePattern.test(firstName) || !namePattern.test(lastName)) {
    return Response.json({ status: 'invalid_name' }, { status: 400, headers: corsHeaders })
  }

  const emailValidation = normalizeHofstraUsername(hofstraUsername)
  if (!emailValidation.ok) {
    return Response.json({ status: 'invalid_email' }, { status: 400, headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceRole) {
    return Response.json({ status: 'invalid_event' }, { status: 500, headers: corsHeaders })
  }

  const supabase = createClient(url, serviceRole)

  const { data: event } = await supabase
    .from('events')
    .select('id,status,registration_open')
    .eq('slug', slug)
    .maybeSingle()

  if (!event) {
    return Response.json({ status: 'invalid_event' }, { status: 404, headers: corsHeaders })
  }

  if (event.status === 'ended') {
    return Response.json({ status: 'ended' }, { status: 200, headers: corsHeaders })
  }

  if (event.status !== 'open' || !event.registration_open) {
    return Response.json({ status: 'closed' }, { status: 200, headers: corsHeaders })
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
    return Response.json({ status: 'rate_limited' }, { status: 429, headers: corsHeaders })
  }

  // Check if this specific submission_id was already accepted
  const { data: existingSubmission } = await supabase
    .from('entries')
    .select('retry_receipt')
    .eq('event_id', event.id)
    .eq('submission_id', submissionId)
    .maybeSingle()

  if (existingSubmission) {
    if (existingSubmission.retry_receipt === retryReceipt) {
      return Response.json({ status: 'accepted', receipt_id: retryReceipt }, { status: 200, headers: corsHeaders })
    }
  }

  // Check if this email is already registered by another submission
  const { data: existingEmail } = await supabase
    .from('entries')
    .select('id, retry_receipt, submission_id')
    .eq('event_id', event.id)
    .eq('hofstra_email', emailValidation.email)
    .maybeSingle()

  if (existingEmail) {
    if (existingEmail.retry_receipt === retryReceipt && existingEmail.submission_id === submissionId) {
      return Response.json({ status: 'accepted', receipt_id: retryReceipt }, { status: 200, headers: corsHeaders })
    }
    // Generic duplicate notification to protect existing entrant privacy
    return Response.json({ status: 'already_checked_in' }, { status: 200, headers: corsHeaders })
  }

  const insertPayload = {
    event_id: event.id,
    first_name: firstName,
    last_name: lastName,
    hofstra_email: emailValidation.email,
    submission_id: submissionId,
    retry_receipt: retryReceipt,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('entries')
    .insert(insertPayload)
    .select('retry_receipt')
    .maybeSingle()

  if (!insertError && inserted) {
    return Response.json({ status: 'accepted', receipt_id: inserted.retry_receipt }, { status: 200, headers: corsHeaders })
  }

  // Handle concurrent insert races
  const { data: raceSubmission } = await supabase
    .from('entries')
    .select('retry_receipt')
    .eq('event_id', event.id)
    .eq('submission_id', submissionId)
    .maybeSingle()

  if (raceSubmission && raceSubmission.retry_receipt === retryReceipt) {
    return Response.json({ status: 'accepted', receipt_id: raceSubmission.retry_receipt }, { status: 200, headers: corsHeaders })
  }

  const { data: raceEmail } = await supabase
    .from('entries')
    .select('id')
    .eq('event_id', event.id)
    .eq('hofstra_email', emailValidation.email)
    .maybeSingle()

  if (raceEmail) {
    return Response.json({ status: 'already_checked_in' }, { status: 200, headers: corsHeaders })
  }

  return Response.json({ status: 'invalid_event' }, { status: 500, headers: corsHeaders })
})
