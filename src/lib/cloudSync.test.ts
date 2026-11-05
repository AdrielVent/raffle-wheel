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
      event_id: 'evt-nasa-2026',
      first_name: 'Adriel',
      last_name: 'Ventura',
      hofstra_email: 'aventura2@hofstra.edu',
      checked_in_at: '2026-11-05T12:00:00Z',
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('raffle_wheel_nasa_space_apps_entries_v1'),
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
      event_id: 'evt-nasa-2026',
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
      event_id: 'evt-nasa-2026',
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
            event_id: 'evt-nasa-2026',
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

    const results = await syncAllRemoteCheckIns('evt-nasa-2026')
    expect(results.some((r) => r.hofstra_email === 'sluke1@hofstra.edu')).toBe(true)
  })

  it('clears event cloud sync, sets cleared_at timestamp, and ignores older check-ins', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    // Add an entry before clearing
    syncIncomingEntry({
      id: 'pre-clear-1',
      event_id: 'evt-nasa-2026',
      first_name: 'Old',
      last_name: 'Attendee',
      hofstra_email: 'old@hofstra.edu',
      ineligible: false,
      checked_in_at: '2026-11-05T12:00:00.000Z',
      created_at: '2026-11-05T12:00:00.000Z',
    })

    await clearEventCloudSync('evt-nasa-2026')

    const raw = localStorage.getItem('raffle_mock_entries_v1')
    const entries = raw ? JSON.parse(raw) : []
    expect(entries.length).toBe(0)

    // Attempting to sync an older check-in should be rejected
    const olderAdded = syncIncomingEntry({
      id: 'older-entry',
      event_id: 'evt-nasa-2026',
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
      event_id: 'evt-nasa-2026',
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
