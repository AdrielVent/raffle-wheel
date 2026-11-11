import type { EntryRow } from '../App'
import { normalizeHofstraUsername } from './hofstraEmail'

export const NTFY_TOPIC = 'raffle_wheel_nasa_space_apps_entries_v1'
export const NTFY_ENDPOINT = `https://ntfy.envs.net/${NTFY_TOPIC}`
export const NTFY_EVENTS_ENDPOINT = `https://ntfy.envs.net/raffle_wheel_events_channel_v1`

export function getEventTopic(eventId?: string): string {
  if (!eventId || eventId === 'evt-nasa-2026') {
    return 'raffle_wheel_nasa_space_apps_entries_v1'
  }
  const clean = eventId.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  return `raffle_evt_${clean}`
}

export function getEventEndpoint(eventId?: string): string {
  return `https://ntfy.envs.net/${getEventTopic(eventId)}`
}
export const GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1XKZnZHX7WbtJMw4T8a822920Y__x5fiuqTsxYo3fs4I/edit?usp=sharing'
export const GOOGLE_SHEET_GVIZ =
  'https://docs.google.com/spreadsheets/d/1XKZnZHX7WbtJMw4T8a822920Y__x5fiuqTsxYo3fs4I/gviz/tq?tqx=out:json'

const STORAGE_KEY_ENTRIES = 'raffle_mock_entries_v1'

/**
 * Broadcasts a newly created event across devices.
 */
export async function broadcastEvent(event: any): Promise<void> {
  try {
    await fetchWithTimeout(
      NTFY_EVENTS_ENDPOINT,
      {
        method: 'POST',
        body: JSON.stringify(event),
        headers: {
          Title: 'Event Created',
          Tags: 'calendar',
        },
      },
      3000,
    )
  } catch (err) {
    console.warn('Event broadcast warning:', err)
  }
}

/**
 * Fetches all cross-device events from the cloud cache.
 */
export async function fetchRemoteEvents(): Promise<any[]> {
  try {
    const res = await fetchWithTimeout(`${NTFY_EVENTS_ENDPOINT}/json?poll=1&since=all`, {}, 3000)
    if (!res.ok) return []
    const text = await res.text()
    const lines = text.split('\n').filter(Boolean)
    const list: any[] = []

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.message) {
          const ev = JSON.parse(parsed.message)
          if (ev.name && ev.slug) {
            if (!list.some((e) => e.slug === ev.slug)) {
              list.push(ev)
            }
          }
        }
      } catch {
        // ignore
      }
    }
    return list
  } catch {
    return []
  }
}

/**
 * Fetch wrapper with an automatic timeout to ensure network requests never hang or freeze the UI.
 */
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 3500): Promise<Response> {
  if (typeof fetch === 'undefined') {
    return Promise.reject(new Error('fetch unavailable'))
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId))
}

/**
 * Broadcasts a clear event across devices in real time.
 */
export async function broadcastClearEvent(eventId: string, clearedAt: string): Promise<void> {
  try {
    const endpoint = getEventEndpoint(eventId)
    await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'clear', event_id: eventId, cleared_at: clearedAt }),
        headers: {
          Title: 'Clear Event Entries',
          Tags: 'wastebasket',
        },
      },
      3000,
    )
  } catch (err) {
    console.warn('Clear event broadcast warning:', err)
  }
}

/**
 * Clears cloud sync storage and broadcasts clear signal to other devices.
 */
export async function clearEventCloudSync(eventId: string): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) return
  const nowIso = new Date().toISOString()
  localStorage.setItem(`raffle_cleared_at_${eventId}`, nowIso)

  const raw = localStorage.getItem(STORAGE_KEY_ENTRIES)
  const entries: EntryRow[] = raw ? JSON.parse(raw) : []
  const remaining = entries.filter((e) => e.event_id !== eventId)
  localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(remaining))
  window.dispatchEvent(new Event('raffle_demo_change'))

  await broadcastClearEvent(eventId, nowIso)
}

/**
 * Broadcasts a newly checked-in attendee to the real-time cloud channel.
 */
export async function broadcastCheckIn(entry: {
  id: string
  event_id: string
  first_name: string
  last_name: string
  hofstra_email: string
  checked_in_at: string
  ineligible?: boolean
}): Promise<void> {
  try {
    const endpoint = getEventEndpoint(entry.event_id)
    await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        body: JSON.stringify(entry),
        headers: {
          Title: 'Attendee Check-In',
          Tags: 'entry',
        },
      },
      3000,
    )
  } catch (err) {
    console.warn('Attendee check-in broadcast warning:', err)
  }
}

/**
 * Fetches all cross-device check-ins from the cloud cache.
 */
export async function fetchRemoteCheckIns(eventId?: string): Promise<EntryRow[]> {
  try {
    const endpoint = getEventEndpoint(eventId)
    const res = await fetchWithTimeout(`${endpoint}/json?poll=1&since=all`, {}, 3000)
    if (!res.ok) return []
    const text = await res.text()
    const lines = text.split('\n').filter(Boolean)
    const list: EntryRow[] = []

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.message) {
          const entry = JSON.parse(parsed.message) as EntryRow
          if (entry.first_name && entry.hofstra_email && entry.event_id) {
            const normalized = entry.hofstra_email.toLowerCase().trim()
            if (
              !list.some(
                (e) =>
                  e.event_id === entry.event_id &&
                  e.hofstra_email.toLowerCase().trim() === normalized,
              )
            ) {
              list.push(entry)
            }
          }
        }
      } catch {
        // ignore malformed line
      }
    }
    return list
  } catch {
    return []
  }
}

/**
 * Fetches rows from the user's shared Google Sheet via GViz.
 */
export async function fetchGoogleSheetCheckIns(eventId: string): Promise<EntryRow[]> {
  try {
    const res = await fetchWithTimeout(GOOGLE_SHEET_GVIZ, {}, 3000)
    if (!res.ok) return []
    const text = await res.text()
    const jsonStr = text.replace(/^[^{]*/, '').replace(/[^}]*$/, '')
    const data = JSON.parse(jsonStr)
    const rows = data?.table?.rows ?? []

    const list: EntryRow[] = []
    for (const row of rows) {
      const c = row.c ?? []
      const v0 = c[0]?.v ? String(c[0].v).trim() : ''
      const v1 = c[1]?.v ? String(c[1].v).trim() : ''
      const v2 = c[2]?.v ? String(c[2].v).trim() : ''
      const v3 = c[3]?.v ? String(c[3].v).trim() : ''

      if (
        !v0 ||
        v0.toLowerCase() === 'event' ||
        v0.toLowerCase() === 'first name' ||
        v1.toLowerCase() === 'first name'
      ) {
        continue
      }

      let first = ''
      let last = ''
      let email = ''

      if (v3) {
        first = v1
        last = v2
        email = v3
      } else if (v2) {
        first = v0
        last = v1
        email = v2
      } else if (v1) {
        const parts = v0.split(/\s+/)
        first = parts[0] || 'Attendee'
        last = parts.slice(1).join(' ') || 'Guest'
        email = v1
      }

      if (first && email) {
        const emailVal = normalizeHofstraUsername(email)
        const normalized = emailVal.ok ? `${emailVal.username}@hofstra.edu` : email
        list.push({
          id: `sheet-${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
          event_id: eventId,
          first_name: first,
          last_name: last || 'Attendee',
          hofstra_email: normalized,
          ineligible: false,
          checked_in_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
      }
    }
    return list
  } catch {
    return []
  }
}

/**
 * Subscribes to live cross-device Server-Sent Events (SSE).
 */
export function subscribeToLiveCheckIns(
  onNewEntry: (entry: EntryRow) => void,
  eventId?: string,
): () => void {
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    return () => {}
  }

  try {
    const endpoint = getEventEndpoint(eventId)
    const es = new EventSource(`${endpoint}/sse`)
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.message) {
          const parsed = JSON.parse(data.message)
          if (parsed.action === 'clear' && parsed.event_id) {
            localStorage.setItem(`raffle_cleared_at_${parsed.event_id}`, parsed.cleared_at)
            const raw = localStorage.getItem(STORAGE_KEY_ENTRIES)
            const entries: EntryRow[] = raw ? JSON.parse(raw) : []
            const remaining = entries.filter((e) => e.event_id !== parsed.event_id)
            localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(remaining))
            window.dispatchEvent(new Event('raffle_demo_change'))
            return
          }

          const entry = parsed as EntryRow
          if (entry.first_name && entry.hofstra_email) {
            syncIncomingEntry(entry)
            onNewEntry(entry)
          }
        }
      } catch {
        // ignore
      }
    }

    return () => {
      es.close()
    }
  } catch {
    return () => {}
  }
}

/**
 * Saves a single incoming entry into local mock storage if not already present.
 */
export function syncIncomingEntry(entry: EntryRow): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false
  try {
    const targetEvent = entry.event_id || 'evt-nasa-2026'
    const clearedAt = localStorage.getItem(`raffle_cleared_at_${targetEvent}`)
    if (clearedAt) {
      const entryTime = new Date(entry.checked_in_at || entry.created_at || 0).getTime()
      const clearTime = new Date(clearedAt).getTime()
      if (entryTime < clearTime) {
        return false
      }
    }

    const raw = localStorage.getItem(STORAGE_KEY_ENTRIES)
    const entries: EntryRow[] = raw ? JSON.parse(raw) : []
    const normalizedEmail = entry.hofstra_email.toLowerCase().trim()

    const exists = entries.some(
      (e) =>
        e.event_id === targetEvent &&
        e.hofstra_email.toLowerCase().trim() === normalizedEmail,
    )

    if (!exists) {
      entries.push({
        ...entry,
        event_id: targetEvent,
        ineligible: entry.ineligible ?? false,
        created_at: entry.created_at || new Date().toISOString(),
      })
      localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(entries))
      window.dispatchEvent(new Event('raffle_demo_change'))
      return true
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * Fetches all entries from the cloud and merges into local storage.
 */
export async function syncAllRemoteCheckIns(eventId = 'evt-nasa-2026'): Promise<EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const [remoteEntries, sheetEntries] = await Promise.all([
      fetchRemoteCheckIns(eventId),
      fetchGoogleSheetCheckIns(eventId),
    ])

    const allInbound = [...remoteEntries, ...sheetEntries]
    if (allInbound.length === 0) {
      const raw = localStorage.getItem(STORAGE_KEY_ENTRIES)
      const current: EntryRow[] = raw ? JSON.parse(raw) : []
      return current.filter(
        (e) => e.event_id === eventId || (!e.event_id && eventId === 'evt-nasa-2026'),
      )
    }

    const raw = localStorage.getItem(STORAGE_KEY_ENTRIES)
    const localEntries: EntryRow[] = raw ? JSON.parse(raw) : []
    let updated = false

    for (const inbound of allInbound) {
      const targetEvent = inbound.event_id || eventId
      const clearedAt = localStorage.getItem(`raffle_cleared_at_${targetEvent}`)
      if (clearedAt) {
        const inboundTime = new Date(inbound.checked_in_at || inbound.created_at || 0).getTime()
        const clearTime = new Date(clearedAt).getTime()
        if (inboundTime < clearTime) {
          continue
        }
      }

      const normalizedEmail = inbound.hofstra_email.toLowerCase().trim()
      const exists = localEntries.some(
        (e) =>
          e.event_id === targetEvent &&
          e.hofstra_email.toLowerCase().trim() === normalizedEmail,
      )

      if (!exists) {
        localEntries.push({
          id: inbound.id || `remote-${crypto.randomUUID()}`,
          event_id: targetEvent,
          first_name: inbound.first_name,
          last_name: inbound.last_name || 'Attendee',
          hofstra_email: inbound.hofstra_email,
          ineligible: Boolean(inbound.ineligible),
          checked_in_at: inbound.checked_in_at || new Date().toISOString(),
          created_at: inbound.created_at || new Date().toISOString(),
        })
        updated = true
      }
    }

    if (updated) {
      localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(localEntries))
      window.dispatchEvent(new Event('raffle_demo_change'))
    }

    return localEntries.filter(
      (e) => e.event_id === eventId || (!e.event_id && eventId === 'evt-nasa-2026'),
    )
  } catch {
    const raw = localStorage.getItem(STORAGE_KEY_ENTRIES)
    const current: EntryRow[] = raw ? JSON.parse(raw) : []
    return current.filter(
      (e) => e.event_id === eventId || (!e.event_id && eventId === 'evt-nasa-2026'),
    )
  }
}
