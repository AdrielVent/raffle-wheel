import { broadcastCheckIn } from './cloudSync'
import { normalizeHofstraUsername } from './hofstraEmail'
import { supabase } from './supabase'
import { validateFullName } from './validation'

export type PublicEvent = {
  id: string
  name: string
  slug: string
  status: 'open' | 'closed' | 'ended'
  registration_open: boolean
}

export type SubmissionResponse = {
  status:
    | 'accepted'
    | 'duplicate'
    | 'already_checked_in'
    | 'duplicate_email'
    | 'closed'
    | 'ended'
    | 'invalid_event'
    | 'invalid_name'
    | 'invalid_email'
    | 'rate_limited'
  receipt_id?: string
  event_id?: string
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  return supabase
}

export async function getPublicEvent(slug: string): Promise<PublicEvent | null> {
  const client = requireSupabase()
  const { data, error } = await client.functions.invoke('public-event', {
    body: { slug },
  })

  if (error) {
    throw error
  }

  if (!data?.event) {
    return null
  }

  return data.event as PublicEvent
}

export async function submitEntry(
  slug: string,
  firstName: string,
  lastName: string,
  hofstraUsernameInput: string,
  submissionId: string,
  retryReceipt: string,
  eventId?: string,
): Promise<SubmissionResponse> {
  const client = requireSupabase()
  const validation = validateFullName(firstName, lastName)

  if (!validation.ok) {
    const firstError = validation.first.message ?? validation.last.message ?? 'Invalid name.'
    throw new Error(firstError)
  }

  const emailValidation = normalizeHofstraUsername(hofstraUsernameInput)
  if (!emailValidation.ok) {
    throw new Error(emailValidation.message ?? 'Invalid Hofstra email username.')
  }

  const { data, error } = await client.functions.invoke('public-submit', {
    body: {
      slug,
      firstName: validation.first.value,
      lastName: validation.last.value,
      hofstraUsername: emailValidation.username,
      submissionId,
      retryReceipt,
    },
  })

  if (error) {
    throw error
  }

  const response = data as SubmissionResponse
  if (response?.status === 'accepted') {
    void broadcastCheckIn({
      id: submissionId,
      event_id: response?.event_id || eventId || 'evt-nasa-2026',
      first_name: validation.first.value,
      last_name: validation.last.value,
      hofstra_email: `${emailValidation.username.toLowerCase()}@hofstra.edu`,
      checked_in_at: new Date().toISOString(),
      ineligible: false,
    })
  }

  return response
}

export async function createEvent(name: string) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_raffle_event', { p_name: name.trim() })
  if (error) throw error
  return data
}

export async function setRegistration(eventId: string, registrationOpen: boolean) {
  const client = requireSupabase()
  const { error } = await client.rpc('set_event_registration', {
    p_event_id: eventId,
    p_registration_open: registrationOpen,
  })

  if (error) throw error
}

export async function endEvent(eventId: string) {
  const client = requireSupabase()
  const { error } = await client.rpc('end_raffle_event', {
    p_event_id: eventId,
  })

  if (error) throw error
}

export async function clearEntries(eventId: string) {
  const client = requireSupabase()
  const { error } = await client.rpc('clear_event_entries', {
    p_event_id: eventId,
  })

  if (error) throw error
}

export async function deleteEventData(eventId: string) {
  const client = requireSupabase()
  const { error } = await client.rpc('delete_event_data', {
    p_event_id: eventId,
  })

  if (error) throw error
}

/**
 * Excludes an attendee from raffle drawing without deleting their attendance record.
 */
export async function setEntryIneligible(eventId: string, entryId: string, ineligible: boolean) {
  const client = requireSupabase()
  const { error } = await client.rpc('set_entry_ineligible', {
    p_event_id: eventId,
    p_entry_id: entryId,
    p_ineligible: ineligible,
  })

  if (error) throw error
}

/**
 * Explicit confirmed deletion of an attendee record.
 */
export async function deleteEntryRecord(eventId: string, entryId: string) {
  const client = requireSupabase()
  const { error } = await client.rpc('delete_entry_record', {
    p_event_id: eventId,
    p_entry_id: entryId,
  })

  if (error) throw error
}

export async function removeEntry(eventId: string, entryId: string) {
  return setEntryIneligible(eventId, entryId, true)
}

export async function runDraw(eventId: string, requestId: string, removeWinner: boolean) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('run_event_draw', {
    p_event_id: eventId,
    p_request_id: requestId,
    p_remove_winner: removeWinner,
  })

  if (error) throw error
  return data
}
