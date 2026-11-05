import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getPublicEvent, submitEntry, setEntryIneligible, deleteEntryRecord } from './api'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
    rpc: vi.fn(),
  },
}))

describe('api functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches public event metadata', async () => {
    const mockInvoke = vi.mocked(supabase!.functions.invoke)
    mockInvoke.mockResolvedValueOnce({
      data: {
        event: {
          id: 'test-event-id',
          name: 'NASA Tech Expo',
          slug: 'nasa2026',
          status: 'open',
          registration_open: true,
        },
      },
      error: null,
    })

    const event = await getPublicEvent('nasa2026')
    expect(event).not.toBeNull()
    expect(event?.name).toBe('NASA Tech Expo')
    expect(mockInvoke).toHaveBeenCalledWith('public-event', {
      body: { slug: 'nasa2026' },
    })
  })

  it('validates names before invoking public-submit', async () => {
    await expect(
      submitEntry('slug', '', 'Ventura', 'aventura2', 'sub-1', 'receipt-1'),
    ).rejects.toThrow('First name is required.')
  })

  it('validates email username before invoking public-submit', async () => {
    await expect(
      submitEntry('slug', 'Adriel', 'Ventura', 'invalid@gmail.com', 'sub-1', 'receipt-1'),
    ).rejects.toThrow('Please use a @hofstra.edu address.')
  })

  it('invokes public-submit with normalized values on valid submission', async () => {
    const mockInvoke = vi.mocked(supabase!.functions.invoke)
    mockInvoke.mockResolvedValueOnce({
      data: { status: 'accepted', receipt_id: 'receipt-1' },
      error: null,
    })

    const response = await submitEntry(
      'slug',
      ' Adriel ',
      ' Ventura ',
      'aventura2@hofstra.edu',
      'sub-1',
      'receipt-1',
    )

    expect(response.status).toBe('accepted')
    expect(mockInvoke).toHaveBeenCalledWith('public-submit', {
      body: {
        slug: 'slug',
        firstName: 'Adriel',
        lastName: 'Ventura',
        hofstraUsername: 'aventura2',
        submissionId: 'sub-1',
        retryReceipt: 'receipt-1',
      },
    })
  })

  it('calls set_entry_ineligible rpc without deleting attendance record', async () => {
    const mockRpc = vi.mocked(supabase!.rpc)
    mockRpc.mockResolvedValueOnce({ data: null, error: null } as any)

    await setEntryIneligible('event-1', 'entry-1', true)

    expect(mockRpc).toHaveBeenCalledWith('set_entry_ineligible', {
      p_event_id: 'event-1',
      p_entry_id: 'entry-1',
      p_ineligible: true,
    })
  })

  it('calls delete_entry_record rpc on explicit deletion', async () => {
    const mockRpc = vi.mocked(supabase!.rpc)
    mockRpc.mockResolvedValueOnce({ data: null, error: null } as any)

    await deleteEntryRecord('event-1', 'entry-1')

    expect(mockRpc).toHaveBeenCalledWith('delete_entry_record', {
      p_event_id: 'event-1',
      p_entry_id: 'entry-1',
    })
  })
})
