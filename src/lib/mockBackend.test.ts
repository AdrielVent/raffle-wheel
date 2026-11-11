import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createMockSupabaseClient, isLegacySampleEntry, uniformRandomIndex } from './mockBackend'

// Every scenario starts the way a real host does: create a brand-new event, then
// people check in through that event's QR code. There are no built-in events or attendees.
async function newEventWithCheckIns(people: Array<[string, string, string]>) {
  const client = createMockSupabaseClient()
  const { data: event } = await client.rpc('create_raffle_event', { p_name: 'Fall Career Mixer' })
  for (const [first, last, username] of people) {
    const res = await client.functions.invoke('public-submit', {
      body: {
        slug: event.slug,
        firstName: first,
        lastName: last,
        hofstraUsername: username,
        submissionId: crypto.randomUUID(),
        retryReceipt: crypto.randomUUID(),
      },
    })
    expect(res.data.status).toBe('accepted')
  }
  return { client, event }
}

describe('createMockSupabaseClient', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    // Never hit the real public relay from tests
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
  })

  it('starts with no events and no attendees', async () => {
    const client = createMockSupabaseClient()
    const { data: events } = await client.from('events').select('*')
    const { data: entries } = await client.from('entries').select('*')
    expect(events).toEqual([])
    expect(entries).toEqual([])
  })

  it('removes the old NASA draft event and the five made-up attendees from existing devices', async () => {
    localStorage.setItem(
      'raffle_mock_events_v1',
      JSON.stringify([
        { id: 'evt-nasa-2026', name: 'NASA Space Apps Challenge', slug: 'nasa-space-apps', status: 'open', registration_open: true, created_at: '2026-11-05T12:00:00.000Z' },
        { id: 'evt-real', name: 'Real Event', slug: 'real-event-abc123', status: 'open', registration_open: true, created_at: '2026-11-10T12:00:00.000Z' },
      ]),
    )
    localStorage.setItem(
      'raffle_mock_entries_v1',
      JSON.stringify([
        { id: 'entry-1', event_id: 'evt-nasa-2026', first_name: 'Alex', last_name: 'Rivera', hofstra_email: 'arivera@hofstra.edu', ineligible: false, checked_in_at: '', created_at: '' },
        { id: 'entry-2', event_id: 'evt-real', first_name: 'Sam', last_name: 'Chen', hofstra_email: 'schen2@hofstra.edu', ineligible: false, checked_in_at: '', created_at: '' },
        { id: 'real-1', event_id: 'evt-real', first_name: 'Dana', last_name: 'Cruz', hofstra_email: 'dcruz4@hofstra.edu', ineligible: false, checked_in_at: '', created_at: '' },
      ]),
    )
    const client = createMockSupabaseClient()
    const { data: events } = await client.from('events').select('*')
    const { data: entries } = await client.from('entries').select('*')
    expect(events.map((e: any) => e.id)).toEqual(['evt-real'])
    expect(entries.map((e: any) => e.id)).toEqual(['real-1'])
  })

  it('only treats the exact legacy sample rows as samples', () => {
    expect(isLegacySampleEntry({ id: 'entry-1', hofstra_email: 'arivera@hofstra.edu' })).toBe(true)
    // A real person who happens to share a sample email (different id) is never removed
    expect(isLegacySampleEntry({ id: 'abc', hofstra_email: 'arivera@hofstra.edu' })).toBe(false)
  })

  it('creates a new event with its own slug and accepts QR check-ins for it', async () => {
    const { client, event } = await newEventWithCheckIns([['Adriel', 'Ventura', 'aventura2']])
    expect(event.slug).toMatch(/^fall-career-mixer-[0-9a-f]{6}$/)

    const { data: publicEvent } = await client.functions.invoke('public-event', { body: { slug: event.slug } })
    expect(publicEvent.event.name).toBe('Fall Career Mixer')

    // Reject duplicate email atomically
    const dupRes = await client.functions.invoke('public-submit', {
      body: { slug: event.slug, firstName: 'Another', lastName: 'Person', hofstraUsername: 'AVentura2', submissionId: 's2', retryReceipt: 'r2' },
    })
    expect(dupRes.data.status).toBe('already_checked_in')
  })

  it('draws only from that event’s check-ins and supports exclusion', async () => {
    const { client, event } = await newEventWithCheckIns([
      ['Dana', 'Cruz', 'dcruz4'],
      ['Lee', 'Park', 'lpark7'],
    ])
    const drawRes = await client.rpc('run_event_draw', { p_event_id: event.id, p_request_id: 'draw-1', p_remove_winner: true })
    expect(drawRes.data.status).toBe('success')
    expect(['Dana', 'Lee']).toContain(drawRes.data.winner_first_name)

    const { data: entries } = await client.from('entries').select('*').eq('event_id', event.id)
    const other = entries.find((e: any) => !e.ineligible)
    await client.rpc('set_entry_ineligible', { p_event_id: event.id, p_entry_id: other.id, p_ineligible: true })
    const empty = await client.rpc('run_event_draw', { p_event_id: event.id, p_request_id: 'draw-2', p_remove_winner: true })
    expect(empty.data.status).toBe('empty')
  })
})

describe('event archiving and locking (local backend)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
  })

  it('archiving locks check-in and drawings but keeps attendance and draw history', async () => {
    const { client, event } = await newEventWithCheckIns([
      ['Dana', 'Cruz', 'dcruz4'],
      ['Lee', 'Park', 'lpark7'],
    ])
    await client.rpc('run_event_draw', { p_event_id: event.id, p_request_id: 'd1', p_remove_winner: false })

    const res = await client.rpc('archive_raffle_event', { p_event_id: event.id, p_archived: true })
    expect(res.error).toBeNull()
    expect(res.data.archived_at).toBeTruthy()
    expect(res.data.status).toBe('ended')

    const submit = await client.functions.invoke('public-submit', {
      body: { slug: event.slug, firstName: 'Late', lastName: 'Comer', hofstraUsername: 'lcomer1', submissionId: 's', retryReceipt: 'r' },
    })
    expect(submit.data.status).toBe('ended')

    const draw = await client.rpc('run_event_draw', { p_event_id: event.id, p_request_id: 'd2', p_remove_winner: false })
    expect(draw.data.status).toBe('ended')

    const { data: entries } = await client.from('entries').select('*').eq('event_id', event.id)
    const { data: draws } = await client.from('draws').select('*').eq('event_id', event.id)
    expect(entries.length).toBe(2)
    expect(draws.length).toBe(1)

    const restored = await client.rpc('archive_raffle_event', { p_event_id: event.id, p_archived: false })
    expect(restored.data.archived_at).toBeNull()
    expect(restored.data.status).toBe('ended')
  })

  it('closing registration rejects new check-ins with "closed"', async () => {
    const { client, event } = await newEventWithCheckIns([])
    await client.rpc('set_event_registration', { p_event_id: event.id, p_registration_open: false })
    const { data: ev } = await client.from('events').select('*').eq('id', event.id).maybeSingle()
    expect(ev.status).toBe('closed')
    const submit = await client.functions.invoke('public-submit', {
      body: { slug: event.slug, firstName: 'Sam', lastName: 'Lee', hofstraUsername: 'slee9', submissionId: 's', retryReceipt: 'r' },
    })
    expect(submit.data.status).toBe('closed')
  })

  it('rejects an email already checked in on another device (relay)', async () => {
    const { client, event } = await newEventWithCheckIns([])
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('poll=1') && String(url).includes('raffle_evt_')) {
        const msg = { id: 'x', event_id: event.id, first_name: 'Other', last_name: 'Phone', hofstra_email: 'twin1@hofstra.edu', checked_in_at: new Date().toISOString() }
        return new Response(JSON.stringify({ message: JSON.stringify(msg) }), { status: 200 })
      }
      return new Response('', { status: 200 })
    })
    const submit = await client.functions.invoke('public-submit', {
      body: { slug: event.slug, firstName: 'Twin', lastName: 'One', hofstraUsername: 'TWIN1', submissionId: 's', retryReceipt: 'r' },
    })
    expect(submit.data.status).toBe('already_checked_in')
  })

  it('draws uniformly with rejection sampling', () => {
    const counts = [0, 0, 0]
    for (let i = 0; i < 3000; i++) counts[uniformRandomIndex(3)]++
    for (const c of counts) {
      expect(c).toBeGreaterThan(800)
      expect(c).toBeLessThan(1200)
    }
  })
})
