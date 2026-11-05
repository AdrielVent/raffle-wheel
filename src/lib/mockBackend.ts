import type { SubmissionResponse } from './api'
import { normalizeHofstraUsername } from './hofstraEmail'
import { validateFullName } from './validation'

export type MockEventRow = {
  id: string
  name: string
  slug: string
  status: 'open' | 'closed' | 'ended'
  registration_open: boolean
  created_at: string
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

const initialEvents: MockEventRow[] = [
  {
    id: 'evt-nasa-2026',
    name: 'NASA Space Apps Challenge',
    slug: 'nasa-space-apps',
    status: 'open',
    registration_open: true,
    created_at: '2026-11-05T12:00:00.000Z',
  },
]

const initialEntries: MockEntryRow[] = [
  {
    id: 'entry-1',
    event_id: 'evt-nasa-2026',
    first_name: 'Alex',
    last_name: 'Rivera',
    hofstra_email: 'arivera@hofstra.edu',
    ineligible: false,
    checked_in_at: '2026-11-05T12:05:00.000Z',
    created_at: '2026-11-05T12:05:00.000Z',
  },
  {
    id: 'entry-2',
    event_id: 'evt-nasa-2026',
    first_name: 'Sam',
    last_name: 'Chen',
    hofstra_email: 'schen2@hofstra.edu',
    ineligible: false,
    checked_in_at: '2026-11-05T12:08:00.000Z',
    created_at: '2026-11-05T12:08:00.000Z',
  },
  {
    id: 'entry-3',
    event_id: 'evt-nasa-2026',
    first_name: 'Jordan',
    last_name: 'Taylor',
    hofstra_email: 'jtaylor@hofstra.edu',
    ineligible: false,
    checked_in_at: '2026-11-05T12:12:00.000Z',
    created_at: '2026-11-05T12:12:00.000Z',
  },
  {
    id: 'entry-4',
    event_id: 'evt-nasa-2026',
    first_name: 'Morgan',
    last_name: 'Patel',
    hofstra_email: 'mpatel@hofstra.edu',
    ineligible: false,
    checked_in_at: '2026-11-05T12:15:00.000Z',
    created_at: '2026-11-05T12:15:00.000Z',
  },
  {
    id: 'entry-5',
    event_id: 'evt-nasa-2026',
    first_name: 'Casey',
    last_name: "O'Connor",
    hofstra_email: 'coconnor@hofstra.edu',
    ineligible: false,
    checked_in_at: '2026-11-05T12:18:00.000Z',
    created_at: '2026-11-05T12:18:00.000Z',
  },
]

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

const listeners: Array<() => void> = []

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // ignore
    }
  }
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
  function setDraws(draws: MockDrawRow[]) {
    setStored(STORAGE_KEY_DRAWS, draws)
    notifyListeners()
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

    channel: () => {
      let subCb: (() => void) | null = null
      return {
        on: (_evt: string, _filter: any, cb: () => void) => {
          subCb = cb
          listeners.push(cb)
          return {
            subscribe: () => ({
              unsubscribe: () => {
                if (subCb) {
                  const idx = listeners.indexOf(subCb)
                  if (idx !== -1) listeners.splice(idx, 1)
                }
              },
            }),
          }
        },
        subscribe: () => ({
          unsubscribe: () => {},
        }),
        unsubscribe: () => {},
      }
    },

    functions: {
      invoke: async (name: string, { body }: { body: any }) => {
        if (name === 'public-event') {
          const events = getEvents()
          const event = events.find((e) => e.slug === body.slug) ?? null
          return {
            data: { event: event ? { ...event } : null },
            error: null,
          }
        }

        if (name === 'public-submit') {
          const events = getEvents()
          const event = events.find((e) => e.slug === body.slug)
          if (!event) {
            return { data: { status: 'invalid_event' }, error: null }
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

          return {
            data: { status: 'accepted', receipt_id: receiptId } as SubmissionResponse,
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
        const newEvent: MockEventRow = {
          id: `evt-${crypto.randomUUID()}`,
          name: args.p_name.trim(),
          slug: `${slug}-${Math.floor(Math.random() * 1000)}`,
          status: 'open',
          registration_open: true,
          created_at: new Date().toISOString(),
        }
        events.unshift(newEvent)
        setEvents(events)
        return { data: newEvent, error: null }
      }

      if (name === 'set_event_registration') {
        const events = getEvents()
        const target = events.find((e) => e.id === args.p_event_id)
        if (target) {
          target.registration_open = Boolean(args.p_registration_open)
          setEvents(events)
        }
        return { data: null, error: null }
      }

      if (name === 'end_raffle_event') {
        const events = getEvents()
        const target = events.find((e) => e.id === args.p_event_id)
        if (target) {
          target.status = 'ended'
          setEvents(events)
        }
        return { data: null, error: null }
      }

      if (name === 'clear_event_entries') {
        const entries = getEntries().filter((e) => e.event_id !== args.p_event_id)
        setEntries(entries)
        return { data: null, error: null }
      }

      if (name === 'delete_event_data') {
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
        const entries = getEntries().filter((e) => e.id !== args.p_entry_id)
        setEntries(entries)
        return { data: null, error: null }
      }

      if (name === 'run_event_draw') {
        const entries = getEntries()
        const eligible = entries.filter((e) => e.event_id === args.p_event_id && !e.ineligible)
        if (eligible.length === 0) {
          return { data: { status: 'empty' }, error: null }
        }

        const randBuffer = new Uint32Array(1)
        crypto.getRandomValues(randBuffer)
        const winnerIndex = randBuffer[0] % eligible.length
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
        setDraws(draws)

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
