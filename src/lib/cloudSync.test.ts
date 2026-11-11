import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  broadcastCheckIn,
  clearEventCloudSync,
  syncIncomingEntry,
  syncAllRemoteCheckIns,
} from './cloudSync'

describe('Cross-Device Cloud Sync', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('broadcasts check-in via POST to ntfy endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('ok', { status: 200 }))

    await broadcastCheckIn({
      id: 'entry-123',
      event_id: 'evt-fall-mixer',
      first_name: 'Adriel',
      last_name: 'Ventura',
      hofstra_email: 'aventura2@hofstra.edu',
      checked_in_at: '2026-11-05T12:00:00Z',
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('raffle_evt_evt-fall-mixer'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Title: 'Attendee Check-In',
        }),
      }),
    )
  })

  it('syncs incoming SSE entry into local storage and triggers change event', () => {
    const changeSpy = vi.fn()
    window.addEventListener('raffle_demo_change', changeSpy)

    const added = syncIncomingEntry({
      id: 'entry-test',
      event_id: 'evt-fall-mixer',
      first_name: 'Adriel',
      last_name: 'Ventura',
      hofstra_email: 'aventura2@hofstra.edu',
      ineligible: false,
      checked_in_at: '2026-11-05T12:00:00Z',
      created_at: '2026-11-05T12:00:00Z',
    })

    expect(added).toBe(true)
    expect(changeSpy).toHaveBeenCalled()

    const raw = localStorage.getItem('raffle_mock_entries_v1')
    expect(raw).toContain('aventura2@hofstra.edu')

    // Duplicate incoming should be rejected
    const dupAdded = syncIncomingEntry({
      id: 'entry-test-dup',
      event_id: 'evt-fall-mixer',
      first_name: 'Adriel',
      last_name: 'Ventura',
      hofstra_email: 'aventura2@hofstra.edu',
      ineligible: false,
      checked_in_at: '2026-11-05T12:05:00Z',
      created_at: '2026-11-05T12:05:00Z',
    })
    expect(dupAdded).toBe(false)

    window.removeEventListener('raffle_demo_change', changeSpy)
  })

  it('syncAllRemoteCheckIns fetches remote entries and merges them', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('poll=1')) {
        const payload = JSON.stringify({
          message: JSON.stringify({
            id: 'remote-1',
            event_id: 'evt-fall-mixer',
            first_name: 'Skywalker',
            last_name: 'Luke',
            hofstra_email: 'sluke1@hofstra.edu',
            checked_in_at: '2026-11-05T12:00:00Z',
          }),
        })
        return new Response(payload, { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })

    const results = await syncAllRemoteCheckIns('evt-fall-mixer')
    expect(results.some((r) => r.hofstra_email === 'sluke1@hofstra.edu')).toBe(true)
  })

  it('clears event cloud sync, sets cleared_at timestamp, and ignores older check-ins', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    // Add an entry before clearing
    syncIncomingEntry({
      id: 'pre-clear-1',
      event_id: 'evt-fall-mixer',
      first_name: 'Old',
      last_name: 'Attendee',
      hofstra_email: 'old@hofstra.edu',
      ineligible: false,
      checked_in_at: '2026-11-05T12:00:00.000Z',
      created_at: '2026-11-05T12:00:00.000Z',
    })

    await clearEventCloudSync('evt-fall-mixer')

    const raw = localStorage.getItem('raffle_mock_entries_v1')
    const entries = raw ? JSON.parse(raw) : []
    expect(entries.length).toBe(0)

    // Attempting to sync an older check-in should be rejected
    const olderAdded = syncIncomingEntry({
      id: 'older-entry',
      event_id: 'evt-fall-mixer',
      first_name: 'Old',
      last_name: 'Cached',
      hofstra_email: 'oldcached@hofstra.edu',
      ineligible: false,
      checked_in_at: '2026-11-05T12:00:00.000Z',
      created_at: '2026-11-05T12:00:00.000Z',
    })
    expect(olderAdded).toBe(false)

    // A fresh check-in after clear should be accepted
    const futureIso = new Date(Date.now() + 60000).toISOString()
    const freshAdded = syncIncomingEntry({
      id: 'fresh-entry',
      event_id: 'evt-fall-mixer',
      first_name: 'Fresh',
      last_name: 'Checkin',
      hofstra_email: 'fresh@hofstra.edu',
      ineligible: false,
      checked_in_at: futureIso,
      created_at: futureIso,
    })
    expect(freshAdded).toBe(true)
  })
})

describe('relay safety: deletions, locks and event status', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  const entry = (email: string, at: string) => ({
    id: `id-${email}`,
    event_id: 'evt-a',
    first_name: 'Pat',
    last_name: 'Doe',
    hofstra_email: email,
    ineligible: false,
    checked_in_at: at,
    created_at: at,
  })

  it('never resurrects an individually deleted attendee', async () => {
    const { markEntryDeleted } = await import('./cloudSync')
    markEntryDeleted('evt-a', 'Gone1@hofstra.edu')
    expect(syncIncomingEntry(entry('gone1@hofstra.edu', new Date().toISOString()))).toBe(false)
  })

  it('ignores check-ins submitted after the event was ended/archived', () => {
    localStorage.setItem(
      'raffle_mock_events_v1',
      JSON.stringify([{ id: 'evt-a', name: 'A', slug: 'a', status: 'ended', registration_open: false, created_at: '2026-11-01T00:00:00Z', ended_at: '2026-11-10T12:00:00Z', archived_at: '2026-11-10T12:00:00Z' }]),
    )
    expect(syncIncomingEntry(entry('ontime@hofstra.edu', '2026-11-10T11:59:00Z'))).toBe(true)
    expect(syncIncomingEntry(entry('late@hofstra.edu', '2026-11-10T12:30:00Z'))).toBe(false)
  })

  it('applies the latest relayed event status (archive) and deletions', async () => {
    const { mergeRemoteEvents } = await import('./cloudSync')
    localStorage.setItem(
      'raffle_mock_events_v1',
      JSON.stringify([
        { id: 'evt-a', name: 'A', slug: 'a', status: 'open', registration_open: true, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
        { id: 'evt-b', name: 'B', slug: 'b', status: 'open', registration_open: true, created_at: '2026-11-01T00:00:00Z' },
      ]),
    )
    const lines = [
      { id: 'evt-a', name: 'A', slug: 'a', status: 'open', registration_open: true, updated_at: '2026-11-01T00:00:00Z' },
      { id: 'evt-a', name: 'A', slug: 'a', status: 'ended', registration_open: false, archived_at: '2026-11-10T12:00:00Z', updated_at: '2026-11-10T12:00:00Z' },
      { id: 'evt-b', name: 'B', slug: 'b', deleted_at: '2026-11-10T12:00:00Z', updated_at: '2026-11-10T12:00:00Z' },
    ]
      .map((m) => JSON.stringify({ message: JSON.stringify(m) }))
      .join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(lines, { status: 200 }))

    expect(await mergeRemoteEvents()).toBe(true)
    const events = JSON.parse(localStorage.getItem('raffle_mock_events_v1')!)
    expect(events).toHaveLength(1)
    expect(events[0].archived_at).toBe('2026-11-10T12:00:00Z')
    expect(events[0].status).toBe('ended')
  })
})

describe('draws made on another device', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('stores a relayed draw once and removes the winner from future draws locally', async () => {
    const { storeRemoteDraw } = await import('./cloudSync')
    syncIncomingEntry({
      id: 'w1', event_id: 'evt-fall-mixer', first_name: 'Lee', last_name: 'Park', hofstra_email: 'lpark7@hofstra.edu',
      ineligible: false, checked_in_at: new Date().toISOString(), created_at: new Date().toISOString(),
    })
    const draw = {
      id: 'd1', event_id: 'evt-fall-mixer', request_id: 'd1', winner_entry_id: 'w1', winner_first_name: 'Lee', winner_last_name: 'Park',
      snapshot_size: 1, remove_winner: true, created_at: new Date().toISOString(), snapshot: [{ id: 'w1', first_name: 'Lee', last_name: 'Park', ineligible: false }],
    }
    expect(storeRemoteDraw(draw)).toBe(true)
    expect(storeRemoteDraw(draw)).toBe(false)
    const entries = JSON.parse(localStorage.getItem('raffle_mock_entries_v1')!)
    expect(entries[0].ineligible).toBe(true)
    expect(JSON.parse(localStorage.getItem('raffle_mock_draws_v1')!)).toHaveLength(1)
  })
})
