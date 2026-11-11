import type { DrawRow, EntryRow, EventRow } from '../App'
import { isLiveBackendConfigured } from './env'
import { normalizeHofstraUsername } from './hofstraEmail'

// Cross-device relay used ONLY when no Supabase backend is configured (the GitHub Pages
// build). With Supabase configured, Postgres + Realtime are the source of truth and
// nothing is published to the public relay.
export const cloudRelayEnabled = !isLiveBackendConfigured

export const NTFY_SERVER = 'https://ntfy.sh'
export const NTFY_EVENTS_ENDPOINT = `${NTFY_SERVER}/raffle_wheel_events_channel_v1`

/** Each event gets its own relay channel, so check-ins never mix between events. */
export function getEventTopic(eventId: string): string {
  const clean = eventId.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  return `raffle_evt_${clean}`
}

export function getEventEndpoint(eventId: string): string {
  return `${NTFY_SERVER}/${getEventTopic(eventId)}`
}
export const GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1XKZnZHX7WbtJMw4T8a822920Y__x5fiuqTsxYo3fs4I/edit?usp=sharing'
export const GOOGLE_SHEET_GVIZ =
  'https://docs.google.com/spreadsheets/d/1XKZnZHX7WbtJMw4T8a822920Y__x5fiuqTsxYo3fs4I/gviz/tq?tqx=out:json'

const STORAGE_KEY_ENTRIES = 'raffle_mock_entries_v1'
const STORAGE_KEY_EVENTS = 'raffle_mock_events_v1'
const STORAGE_KEY_DRAWS = 'raffle_mock_draws_v1'

type RelayEvent = EventRow & { deleted_at?: string | null }

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function tombstoneKey(eventId: string) {
  return `raffle_deleted_${eventId}`
}

/** Remembers a deleted attendee so relay replays never resurrect them. */
export function markEntryDeleted(eventId: string, hofstraEmail: string): void {
  try {
    const list = readJson<string[]>(tombstoneKey(eventId), [])
    const email = hofstraEmail.toLowerCase().trim()
    if (!list.includes(email)) {
      list.push(email)
      localStorage.setItem(tombstoneKey(eventId), JSON.stringify(list))
    }
  } catch {
    // ignore
  }
}

function isTombstoned(eventId: string, hofstraEmail: string): boolean {
  return readJson<string[]>(tombstoneKey(eventId), []).includes(hofstraEmail.toLowerCase().trim())
}

/**
 * True when an inbound check-in must be ignored for this event: older than a
 * "Delete All", deleted individually, or submitted after the event was ended/archived.
 */
function shouldRejectInbound(eventId: string, entry: Pick<EntryRow, 'hofstra_email' | 'checked_in_at' | 'created_at'>): boolean {
  const entryTime = new Date(entry.checked_in_at || entry.created_at || 0).getTime()

  const clearedAt = localStorage.getItem(`raffle_cleared_at_${eventId}`)
  if (clearedAt && entryTime < new Date(clearedAt).getTime()) {
    return true
  }

  if (isTombstoned(eventId, entry.hofstra_email)) {
    return true
  }

  const event = readJson<EventRow[]>(STORAGE_KEY_EVENTS, []).find((e) => e.id === eventId)
  const lockedAt = event?.ended_at || event?.archived_at
  if (lockedAt && entryTime > new Date(lockedAt).getTime()) {
    return true
  }

  return false
}

/**
 * Broadcasts an event's current state (created, opened/closed, ended, archived, deleted)
 * so every device — phones included — sees the latest status.
 */
export async function broadcastEvent(event: RelayEvent): Promise<void> {
  if (!cloudRelayEnabled) return
  try {
    await fetchWithTimeout(
      NTFY_EVENTS_ENDPOINT,
      {
        method: 'POST',
        body: JSON.stringify(event),
        headers: {
          Title: 'Event Update',
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
 * Fetches cross-device events from the relay cache. Later messages win, so the
 * returned list reflects each event's latest broadcast state (including deletions).
 */
export async function fetchRemoteEvents(): Promise<RelayEvent[]> {
  if (!cloudRelayEnabled) return []
  try {
    const res = await fetchWithTimeout(`${NTFY_EVENTS_ENDPOINT}/json?poll=1&since=all`, {}, 3000)
    if (!res.ok) return []
    const text = await res.text()
    const lines = text.split('\n').filter(Boolean)
    const latest = new Map<string, RelayEvent>()

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.message) {
          const ev = JSON.parse(parsed.message) as RelayEvent
          if (ev.name && ev.slug) {
            const key = ev.id || ev.slug
            latest.set(key, { ...latest.get(key), ...ev })
          }
        }
      } catch {
        // ignore
      }
    }
    return Array.from(latest.values())
  } catch {
    return []
  }
}

/**
 * Pulls the relay's event list into local storage: adds new events, applies newer
 * status changes (close/end/archive) and drops deleted ones. Returns true if anything changed.
 */
export async function mergeRemoteEvents(): Promise<boolean> {
  if (!cloudRelayEnabled || typeof window === 'undefined') return false
  const remote = await fetchRemoteEvents()
  if (remote.length === 0) return false

  const current = readJson<EventRow[]>(STORAGE_KEY_EVENTS, [])
  let changed = false

  for (const re of remote) {
    const idx = current.findIndex((c) => (re.id && c.id === re.id) || c.slug === re.slug)
    if (re.deleted_at) {
      if (idx >= 0) {
        current.splice(idx, 1)
        changed = true
      }
      continue
    }
    if (idx < 0) {
      current.unshift({
        id: re.id,
        name: re.name,
        slug: re.slug,
        status: re.status ?? 'open',
        registration_open: re.registration_open ?? true,
        created_at: re.created_at ?? new Date().toISOString(),
        updated_at: re.updated_at ?? re.created_at,
        ended_at: re.ended_at ?? null,
        archived_at: re.archived_at ?? null,
      })
      changed = true
      continue
    }
    const local = current[idx]
    if ((re.updated_at ?? '') > (local.updated_at ?? '')) {
      current[idx] = {
        ...local,
        status: re.status ?? local.status,
        registration_open: re.registration_open ?? local.registration_open,
        ended_at: re.ended_at ?? null,
        archived_at: re.archived_at ?? null,
        updated_at: re.updated_at,
      }
      changed = true
    }
  }

  if (changed) {
    localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(current))
    window.dispatchEvent(new Event('raffle_demo_change'))
  }
  return changed
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
  if (!cloudRelayEnabled) return
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

  const entries = readJson<EntryRow[]>(STORAGE_KEY_ENTRIES, [])
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
  if (!cloudRelayEnabled) return
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

/** Reads every cached message on an event's relay topic. */
async function pollTopic(eventId: string): Promise<any[]> {
  if (!cloudRelayEnabled || !eventId) return []
  try {
    const res = await fetchWithTimeout(`${getEventEndpoint(eventId)}/json?poll=1&since=all`, {}, 3000)
    if (!res.ok) return []
    const text = await res.text()
    const out: any[] = []
    for (const line of text.split('\n').filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.message) out.push(JSON.parse(parsed.message))
      } catch {
        // ignore malformed line
      }
    }
    return out
  } catch {
    return []
  }
}

function checkInsFrom(messages: any[]): EntryRow[] {
  const list: EntryRow[] = []
  for (const entry of messages as EntryRow[]) {
    if (entry?.first_name && entry.hofstra_email && entry.event_id) {
      const normalized = entry.hofstra_email.toLowerCase().trim()
      if (!list.some((e) => e.event_id === entry.event_id && e.hofstra_email.toLowerCase().trim() === normalized)) {
        list.push(entry)
      }
    }
  }
  return list
}

/**
 * Fetches all cross-device check-ins from the cloud cache.
 */
export async function fetchRemoteCheckIns(eventId: string): Promise<EntryRow[]> {
  return checkInsFrom(await pollTopic(eventId))
}

/** Shares a completed draw so every device (e.g. the host laptop exporting Excel) knows the winner. */
export async function broadcastDraw(draw: DrawRow): Promise<void> {
  if (!cloudRelayEnabled) return
  try {
    await fetchWithTimeout(
      getEventEndpoint(draw.event_id),
      {
        method: 'POST',
        body: JSON.stringify({ action: 'draw', event_id: draw.event_id, draw }),
        headers: { Title: 'Raffle Draw', Tags: 'tada' },
      },
      3000,
    )
  } catch (err) {
    console.warn('Draw broadcast warning:', err)
  }
}

/** Stores a relayed draw locally (once) and applies "remove winner from future draws". */
export function storeRemoteDraw(draw: DrawRow): boolean {
  if (typeof window === 'undefined' || !draw?.id || !draw.event_id) return false
  try {
    const draws = readJson<DrawRow[]>(STORAGE_KEY_DRAWS, [])
    if (draws.some((d) => d.id === draw.id)) return false
    draws.unshift(draw)
    draws.sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
    localStorage.setItem(STORAGE_KEY_DRAWS, JSON.stringify(draws))
    if (draw.remove_winner && draw.winner_entry_id) {
      const entries = readJson<EntryRow[]>(STORAGE_KEY_ENTRIES, [])
      const winner = entries.find((e) => e.id === draw.winner_entry_id)
      if (winner && !winner.ineligible) {
        winner.ineligible = true
        localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(entries))
      }
    }
    window.dispatchEvent(new Event('raffle_demo_change'))
    return true
  } catch {
    return false
  }
}

/**
 * Reads rows from the shared Google Sheet via GViz. Only used by the host's explicit
 * "Sync Google Sheet" action — never automatically, so sheet rows can't leak into
 * unrelated events or reappear after "Delete All".
 */
export async function fetchGoogleSheetCheckIns(eventId: string): Promise<EntryRow[]> {
  try {
    const res = await fetchWithTimeout(GOOGLE_SHEET_GVIZ, {}, 5000)
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
  eventId: string,
): () => void {
  if (!cloudRelayEnabled || !eventId || typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
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
            const entries = readJson<EntryRow[]>(STORAGE_KEY_ENTRIES, [])
            const remaining = entries.filter((e) => e.event_id !== parsed.event_id)
            localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(remaining))
            window.dispatchEvent(new Event('raffle_demo_change'))
            return
          }

          if (parsed.action === 'draw' && parsed.draw) {
            storeRemoteDraw(parsed.draw as DrawRow)
            return
          }

          const entry = parsed as EntryRow
          if (entry.first_name && entry.hofstra_email) {
            if (syncIncomingEntry(entry)) {
              onNewEntry(entry)
            }
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
    // A check-in always belongs to exactly one event; never guess
    if (!entry.event_id) return false
    const targetEvent = entry.event_id
    if (shouldRejectInbound(targetEvent, entry)) {
      return false
    }

    const entries = readJson<EntryRow[]>(STORAGE_KEY_ENTRIES, [])
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
 * Fetches all relayed check-ins for one event and merges them into local storage.
 */
export async function syncAllRemoteCheckIns(eventId: string): Promise<EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) return []
  const forEvent = (list: EntryRow[]) => list.filter((e) => e.event_id === eventId)
  try {
    const messages = await pollTopic(eventId)
    const remoteEntries = checkInsFrom(messages)
    const localEntries = readJson<EntryRow[]>(STORAGE_KEY_ENTRIES, [])
    if (remoteEntries.length === 0) {
      return forEvent(localEntries)
    }

    let updated = false
    for (const inbound of remoteEntries) {
      const targetEvent = inbound.event_id || eventId
      if (shouldRejectInbound(targetEvent, inbound)) {
        continue
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

    // Draws made on another device (usually the projector laptop)
    for (const m of messages) {
      if (m?.action === 'draw' && m.draw && m.draw.event_id === eventId) storeRemoteDraw(m.draw as DrawRow)
    }

    return forEvent(readJson<EntryRow[]>(STORAGE_KEY_ENTRIES, []))
  } catch {
    return forEvent(readJson<EntryRow[]>(STORAGE_KEY_ENTRIES, []))
  }
}
