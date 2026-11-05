import { describe, expect, it, beforeEach } from 'vitest'
import { createMockSupabaseClient } from './mockBackend'

describe('createMockSupabaseClient', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initializes default event and sample attendees', async () => {
    const client = createMockSupabaseClient()
    const { data: events } = await client.from('events').select('*')
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].slug).toBe('nasa-space-apps')

    const { data: entries } = await client.from('entries').select('*')
    expect(entries.length).toBe(5)
  })

  it('handles public-event and public-submit functions', async () => {
    const client = createMockSupabaseClient()
    const { data: eventData } = await client.functions.invoke('public-event', {
      body: { slug: 'nasa-space-apps' },
    })
    expect(eventData?.event?.name).toBe('NASA Space Apps Challenge')

    const submitRes = await client.functions.invoke('public-submit', {
      body: {
        slug: 'nasa-space-apps',
        firstName: 'Adriel',
        lastName: 'Ventura',
        hofstraUsername: 'aventura2',
        submissionId: 'sub-test-1',
        retryReceipt: 'rec-test-1',
      },
    })
    expect(submitRes.data?.status).toBe('accepted')

    // Reject duplicate email atomically
    const dupRes = await client.functions.invoke('public-submit', {
      body: {
        slug: 'nasa-space-apps',
        firstName: 'Another',
        lastName: 'Person',
        hofstraUsername: 'aventura2',
        submissionId: 'sub-test-2',
        retryReceipt: 'rec-test-2',
      },
    })
    expect(dupRes.data?.status).toBe('already_checked_in')
  })

  it('handles rpc calls: draw, eligibility, and lifecycle', async () => {
    const client = createMockSupabaseClient()
    const drawRes = await client.rpc('run_event_draw', {
      p_event_id: 'evt-nasa-2026',
      p_request_id: 'draw-1',
      p_remove_winner: true,
    })
    expect(drawRes.data?.status).toBe('success')
    expect(drawRes.data?.winner_first_name).toBeTruthy()

    // Test ineligibility toggle
    await client.rpc('set_entry_ineligible', {
      p_event_id: 'evt-nasa-2026',
      p_entry_id: 'entry-1',
      p_ineligible: true,
    })
    const { data: updatedEntries } = await client.from('entries').select('*')
    const entry1 = updatedEntries.find((e: any) => e.id === 'entry-1')
    expect(entry1?.ineligible).toBe(true)
  })
})
