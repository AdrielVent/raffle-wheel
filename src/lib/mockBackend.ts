import type { SubmissionResponse } from './api'
import {
  broadcastCheckIn,
  broadcastDraw,
  broadcastEvent,
  clearEventCloudSync,
  fetchRemoteCheckIns,
  markEntryDeleted,
} from './cloudSync'
import { normalizeHofstraUsername } from './hofstraEmail'
import { validateFullName } from './validation'

export type MockEventRow = {
  id: string
  name: string
  slug: string
  status: 'open' | 'closed' | 'ended'
  registration_open: boolean
  created_at: string
  updated_at?: string
  ended_at?: string | null
  archived_at?: string | null
}

export type MockEntryRow = {
  id: string
  event_id: string
  first_name: string
  last_name: string
  hofstra_email: string
  ineligible: boolean
  checked_in_at: string
  created_at: string
}

export type MockDrawRow = {
  id: string
  event_id: string
  winner_entry_id: string | null
  winner_first_name: string | null
  winner_last_name: string | null
  remove_winner: boolean
  snapshot_size: number
  snapshot: Array<{ id: string; first_name: string; last_name: string; ineligible: boolean }>
  created_at: string
}

const STORAGE_KEY_EVENTS = 'raffle_mock_events_v1'
const STORAGE_KEY_ENTRIES = 'raffle_mock_entries_v1'
const STORAGE_KEY_DRAWS = 'raffle_mock_draws_v1'

// No built-in events: every event is created by the host, and its wheel and attendance
// sheet only ever contain people who checked in through that event's own QR code.
const initialEvents: MockEventRow[] = []

// Older builds shipped a pre-made "NASA Space Apps Challenge" draft event. It is removed
// (with its draft check-ins and draws) from devices that still have it.
const LEGACY_DRAFT_EVENT = { id: 'evt-nasa-2026', slug: 'nasa-space-apps' }

// No sample attendees: only people who check in through an event's QR code belong on
// that event's wheel and in its attendance sheet.
const initialEntries: MockEntryRow[] = []

// Older builds pre-filled the NASA event with five made-up attendees. Remove exactly those
// rows (matched on both their seed id and sample email) from devices that still have them.
const LEGACY_SAMPLE_ROWS: Array<[string, string]> = [
  ['entry-1', 'arivera@hofstra.edu'],
  ['entry-2', 'schen2@hofstra.edu'],
  ['entry-3', 'jtaylor@hofstra.edu'],
  ['entry-4', 'mpatel@hofstra.edu'],
  ['entry-5', 'coconnor@hofstra.edu'],
]

export function isLegacySampleEntry(entry: { id: string; hofstra_email?: string | null }): boolean {
  return LEGACY_SAMPLE_ROWS.some(([id, email]) => entry.id === id && entry.hofstra_email === email)
}

function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    // ignore
  }
  return fallback
}

function setStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

const listeners: Array<(payload?: any) => void> = []

function notifyListeners(payload?: any) {
  for (const fn of listeners) {
    try {
      fn(payload)
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new Event('raffle_demo_change'))
    } catch {
      // ignore
    }
  }
}

/** Unbiased index in [0, count) via rejection sampling over crypto.getRandomValues. */
export function uniformRandomIndex(count: number): number {
  if (count <= 0) throw new Error('Count must be positive')
  const range = 0x100000000
  const limit = range - (range % count)
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % count
  }
}

function touch(event: MockEventRow): MockEventRow {
  event.updated_at = new Date().toISOString()
  return event
}

export function createMockSupabaseClient(): any {
  // Initialize mock data if empty
  if (!localStorage.getItem(STORAGE_KEY_EVENTS)) {
    setStored(STORAGE_KEY_EVENTS, initialEvents)
  }
  if (!localStorage.getItem(STORAGE_KEY_ENTRIES)) {
    setStored(STORAGE_KEY_ENTRIES, initialEntries)
  }
  if (!localStorage.getItem(STORAGE_KEY_DRAWS)) {
    setStored(STORAGE_KEY_DRAWS, [])
  }
  {
    const events = getStored<MockEventRow[]>(STORAGE_KEY_EVENTS, [])
    const isDraft = (e: MockEventRow) => e.id === LEGACY_DRAFT_EVENT.id && e.slug === LEGACY_DRAFT_EVENT.slug
    if (events.some(isDraft)) {
      setStored(STORAGE_KEY_EVENTS, events.filter((e) => !isDraft(e)))
      setStored(
        STORAGE_KEY_ENTRIES,
        getStored<MockEntryRow[]>(STORAGE_KEY_ENTRIES, []).filter((e) => e.event_id !== LEGACY_DRAFT_EVENT.id),
      )
      setStored(
        STORAGE_KEY_DRAWS,
        getStored<MockDrawRow[]>(STORAGE_KEY_DRAWS, []).filter((d) => d.event_id !== LEGACY_DRAFT_EVENT.id),
      )
    }
  }
  {
    const stored = getStored<MockEntryRow[]>(STORAGE_KEY_ENTRIES, [])
    const cleaned = stored.filter((e) => !isLegacySampleEntry(e))
    if (cleaned.length !== stored.length) {
      setStored(STORAGE_KEY_ENTRIES, cleaned)
      const sampleIds = new Set(stored.filter(isLegacySampleEntry).map((e) => e.id))
      const draws = getStored<MockDrawRow[]>(STORAGE_KEY_DRAWS, [])
      setStored(
        STORAGE_KEY_DRAWS,
        draws.filter((d) => !d.winner_entry_id || !sampleIds.has(d.winner_entry_id)),
      )
    }
  }

  function getEvents(): MockEventRow[] {
    return getStored<MockEventRow[]>(STORAGE_KEY_EVENTS, initialEvents)
  }
  function setEvents(events: MockEventRow[]) {
    setStored(STORAGE_KEY_EVENTS, events)
    notifyListeners()
  }

  function getEntries(): MockEntryRow[] {
    return getStored<MockEntryRow[]>(STORAGE_KEY_ENTRIES, initialEntries)
  }
  function setEntries(entries: MockEntryRow[]) {
    setStored(STORAGE_KEY_ENTRIES, entries)
    notifyListeners()
  }

  function getDraws(): MockDrawRow[] {
    return getStored<MockDrawRow[]>(STORAGE_KEY_DRAWS, [])
  }
  function setDraws(draws: MockDrawRow[], newDraw?: MockDrawRow) {
    setStored(STORAGE_KEY_DRAWS, draws)
    notifyListeners({ new: newDraw })
  }

  function createQuery(data: any[]) {
    let current = [...data]
    const q: any = {
      select: () => q,
      eq: (col: string, val: any) => {
        current = current.filter((item) => item[col] === val)
        return q
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        const asc = opts?.ascending !== false
        current.sort((a, b) => {
          if (a[col] < b[col]) return asc ? -1 : 1
          if (a[col] > b[col]) return asc ? 1 : -1
          return 0
        })
        return q
      },
      limit: (n: number) => {
        current = current.slice(0, n)
        return q
      },
      maybeSingle: async () => ({ data: current[0] ?? null, error: null }),
      single: async () => ({
        data: current[0] ?? null,
        error: current[0] ? null : new Error('Row not found'),
      }),
      then: (resolve: any, reject?: any) =>
        Promise.resolve({ data: current, error: null }).then(resolve, reject),
    }
    return q
  }

  return {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'mock-host-user', email: 'host@hofstra.edu' } } },
        error: null,
      }),
      onAuthStateChange: (cb: any) => {
        cb('SIGNED_IN', { user: { id: 'mock-host-user', email: 'host@hofstra.edu' } })
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithOtp: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
    },

    from: (table: string) => {
      if (table === 'events') {
        return createQuery(getEvents())
      }
      if (table === 'entries') {
        return createQuery(getEntries())
      }
      if (table === 'draws') {
        return createQuery(getDraws())
      }
      return createQuery([])
    },

    channel: (name: string) => {
      const channelListeners: Array<(payload?: any) => void> = []
      const channelObj: any = {
        name,
        on: (_evt: string, _filter: any, cb: (payload?: any) => void) => {
          channelListeners.push(cb)
          listeners.push(cb)
          return channelObj
        },
        subscribe: () => channelObj,
        unsubscribe: () => {
          for (const cb of channelListeners) {
            const idx = listeners.indexOf(cb)
            if (idx !== -1) listeners.splice(idx, 1)
          }
        },
      }
      return channelObj
    },

    functions: {
      invoke: async (name: string, { body }: { body: any }) => {
        if (name === 'public-event') {
          const events = getEvents()
          // Prefer the id carried in the QR code: a projector that hasn't synced yet may
          // briefly show a QR with a placeholder slug.
          const event =
            (body.eventId && events.find((e) => e.id === body.eventId)) ||
            events.find((e) => e.slug === body.slug) ||
            null
          return {
            data: { event: event ? { ...event } : null },
            error: null,
          }
        }

        if (name === 'public-submit') {
          const events = getEvents()
          let event =
            (body.eventId && events.find((e) => e.id === body.eventId)) ||
            events.find((e) => e.slug === body.slug)
          if (!event && body.eventId && body.eventName) {
            event = {
              id: body.eventId,
              name: body.eventName,
              slug: body.slug,
              status: 'open',
              registration_open: true,
              created_at: new Date().toISOString(),
            }
            events.push(event)
            setEvents(events)
          }
          if (!event) {
            return { data: { status: 'invalid_event' }, error: null }
          }
          if (event.status === 'ended' || event.archived_at) {
            return { data: { status: 'ended' }, error: null }
          }
          if (event.status !== 'open' || !event.registration_open) {
            return { data: { status: 'closed' }, error: null }
          }

          const validation = validateFullName(body.firstName, body.lastName)
          if (!validation.ok) {
            return { data: { status: 'invalid_name' }, error: null }
          }

          const emailVal = normalizeHofstraUsername(body.hofstraUsername)
          if (!emailVal.ok) {
            return { data: { status: 'invalid_email' }, error: null }
          }

          const normalizedEmail = `${emailVal.username.toLocaleLowerCase()}@hofstra.edu`
          const entries = getEntries()

          // Check duplicate email for this event
          const existing = entries.find(
            (e) => e.event_id === event.id && e.hofstra_email.toLocaleLowerCase() === normalizedEmail,
          )
          if (existing) {
            return { data: { status: 'already_checked_in' }, error: null }
          }

          // Cross-device duplicate check: someone may have checked in with this email on another phone
          const remote = await fetchRemoteCheckIns(event.id)
          if (
            remote.some(
              (e) => e.event_id === event.id && e.hofstra_email.toLocaleLowerCase().trim() === normalizedEmail,
            )
          ) {
            return { data: { status: 'already_checked_in' }, error: null }
          }

          const receiptId = body.retryReceipt || crypto.randomUUID()
          const newEntry: MockEntryRow = {
            id: body.submissionId || crypto.randomUUID(),
            event_id: event.id,
            first_name: validation.first.value,
            last_name: validation.last.value,
            hofstra_email: normalizedEmail,
            ineligible: false,
            checked_in_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          }

          entries.push(newEntry)
          setEntries(entries)

          // Broadcast to other devices (host laptop, projector wheel) in real time
          void broadcastCheckIn(newEntry)

          return {
            data: { status: 'accepted', receipt_id: receiptId, event_id: event.id } as SubmissionResponse,
            error: null,
          }
        }

        return { data: null, error: new Error(`Unknown mock function: ${name}`) }
      },
    },

    rpc: async (name: string, args: any) => {
      if (name === 'create_raffle_event') {
        const events = getEvents()
        const slug = args.p_name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
        const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
        const now = new Date().toISOString()
        const newEvent: MockEventRow = {
          id: `evt-${crypto.randomUUID()}`,
          name: args.p_name.trim(),
          slug: `${slug || 'event'}-${suffix}`,
          status: 'open',
          registration_open: true,
          created_at: now,
          updated_at: now,
          ended_at: null,
          archived_at: null,
        }
        events.unshift(newEvent)
        setEvents(events)
        void broadcastEvent(newEvent)
        return { data: newEvent, error: null }
      }

      if (name === 'set_event_registration') {
        const events = getEvents()
        const target = events.find((e) => e.id === args.p_event_id)
        if (!target) return { data: null, error: new Error('Event not found') }
        if (target.status !== 'ended') {
          target.registration_open = Boolean(args.p_registration_open)
          target.status = target.registration_open ? 'open' : 'closed'
          touch(target)
          setEvents(events)
          void broadcastEvent(target)
        }
        return { data: null, error: null }
      }

      if (name === 'end_raffle_event') {
        const events = getEvents()
        const target = events.find((e) => e.id === args.p_event_id)
        if (!target) return { data: null, error: new Error('Event not found') }
        target.status = 'ended'
        target.registration_open = false
        target.ended_at = target.ended_at ?? new Date().toISOString()
        touch(target)
        setEvents(events)
        void broadcastEvent(target)
        return { data: null, error: null }
      }

      if (name === 'archive_raffle_event') {
        const events = getEvents()
        const target = events.find((e) => e.id === args.p_event_id)
        if (!target) return { data: null, error: new Error('Event not found') }
        const now = new Date().toISOString()
        if (args.p_archived) {
          // Archiving locks check-ins and draws but keeps attendance and draw history
          target.status = 'ended'
          target.registration_open = false
          target.ended_at = target.ended_at ?? now
          target.archived_at = now
        } else {
          target.archived_at = null
        }
        touch(target)
        setEvents(events)
        void broadcastEvent(target)
        return { data: { ...target }, error: null }
      }

      if (name === 'clear_event_entries') {
        // Also records a clear marker + relay broadcast so replays never bring entries back
        await clearEventCloudSync(args.p_event_id)
        const entries = getEntries().filter((e) => e.event_id !== args.p_event_id)
        setEntries(entries)
        return { data: null, error: null }
      }

      if (name === 'delete_event_data') {
        const doomed = getEvents().find((e) => e.id === args.p_event_id)
        if (doomed) {
          void broadcastEvent({ ...touch({ ...doomed }), deleted_at: new Date().toISOString() } as any)
        }
        const events = getEvents().filter((e) => e.id !== args.p_event_id)
        const entries = getEntries().filter((e) => e.event_id !== args.p_event_id)
        const draws = getDraws().filter((d) => d.event_id !== args.p_event_id)
        setEvents(events)
        setEntries(entries)
        setDraws(draws)
        return { data: null, error: null }
      }

      if (name === 'set_entry_ineligible') {
        const entries = getEntries()
        const entry = entries.find((e) => e.id === args.p_entry_id)
        if (entry) {
          entry.ineligible = Boolean(args.p_ineligible)
          setEntries(entries)
        }
        return { data: null, error: null }
      }

      if (name === 'delete_entry_record') {
        const doomed = getEntries().find((e) => e.id === args.p_entry_id)
        if (doomed) markEntryDeleted(doomed.event_id, doomed.hofstra_email)
        const entries = getEntries().filter((e) => e.id !== args.p_entry_id)
        setEntries(entries)
        return { data: null, error: null }
      }

      if (name === 'run_event_draw') {
        const event = getEvents().find((e) => e.id === args.p_event_id)
        if (event && (event.status === 'ended' || event.archived_at)) {
          return { data: { status: 'ended' }, error: null }
        }
        const entries = getEntries()
        const eligible = entries.filter((e) => e.event_id === args.p_event_id && !e.ineligible)
        if (eligible.length === 0) {
          return { data: { status: 'empty' }, error: null }
        }

        const winnerIndex = uniformRandomIndex(eligible.length)
        const winner = eligible[winnerIndex]

        if (args.p_remove_winner) {
          const entryInList = entries.find((e) => e.id === winner.id)
          if (entryInList) entryInList.ineligible = true
          setEntries(entries)
        }

        const draws = getDraws()
        const newDraw: MockDrawRow = {
          id: args.p_request_id || crypto.randomUUID(),
          event_id: args.p_event_id,
          winner_entry_id: winner.id,
          winner_first_name: winner.first_name,
          winner_last_name: winner.last_name,
          remove_winner: Boolean(args.p_remove_winner),
          snapshot_size: eligible.length,
          snapshot: eligible.map((e) => ({
            id: e.id,
            first_name: e.first_name,
            last_name: e.last_name,
            ineligible: e.ineligible,
          })),
          created_at: new Date().toISOString(),
        }
        draws.unshift(newDraw)
        setDraws(draws, newDraw)
        void broadcastDraw(newDraw as any)

        return {
          data: {
            status: 'success',
            winner_entry_id: winner.id,
            winner_first_name: winner.first_name,
            winner_last_name: winner.last_name,
            snapshot_size: eligible.length,
          },
          error: null,
        }
      }

      return { data: null, error: null }
    },
  }
}
