import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import QRCode from 'qrcode'
import {
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'
import './App.css'
import {
  clearEntries,
  createEvent,
  deleteEntryRecord,
  deleteEventData,
  endEvent,
  getPublicEvent,
  runDraw,
  setEntryIneligible,
  setRegistration,
  submitEntry,
} from './lib/api'
import { isBackendConfigured, isLiveBackendConfigured } from './lib/env'
import { findDuplicateNameIds } from './lib/duplicates'
import {
  clearEventCloudSync,
  subscribeToLiveCheckIns,
  syncAllRemoteCheckIns,
  syncIncomingEntry,
} from './lib/cloudSync'
import { downloadAttendanceExcel } from './lib/excel'
import { getPreferenceKey, getReceiptKey } from './lib/storage'
import { supabase } from './lib/supabase'
import { normalizeHofstraUsername } from './lib/hofstraEmail'
import { validateFullName } from './lib/validation'
import { computeWheelRotation } from './lib/wheel'

export type EventRow = {
  id: string
  name: string
  slug: string
  status: 'open' | 'closed' | 'ended'
  registration_open: boolean
  created_at: string
}

export type EntryRow = {
  id: string
  event_id: string
  first_name: string
  last_name: string
  hofstra_email: string
  checked_in_at: string | null
  ineligible: boolean
  created_at: string
}

export type DrawRow = {
  id: string
  event_id: string
  request_id: string
  winner_entry_id: string | null
  winner_first_name: string | null
  winner_last_name: string | null
  snapshot_size: number
  remove_winner: boolean
  created_at: string
  snapshot: Array<{ id: string; first_name: string; last_name: string; ineligible: boolean }>
}

function BackendRequiredMessage() {
  return (
    <div className="panel ipod-card">
      <div className="ipod-screen-bar">
        <span>System Alert</span>
        <span className="ipod-battery-icon" />
      </div>
      <div className="ipod-card-content">
        <h2>Backend Setup Required</h2>
        <p>
          This app is intentionally disabled until Supabase credentials are configured.
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
        </p>
      </div>
    </div>
  )
}

function HomePage() {
  return (
    <main className="container narrow">
      <header className="page-header">
        <div className="ipod-status-bar">
          <span className="status-title">QR Raffle Wheel</span>
          <span className="status-time">NASA Event</span>
        </div>
        <h1>QR Raffle Wheel</h1>
        <p className="subtitle">Event check-in and server-authoritative raffle drawings</p>
      </header>

      {!isLiveBackendConfigured && (
        <section className="panel ipod-card">
          <div className="ipod-screen-bar">
            <span>Test Mode Active</span>
            <span className="ipod-battery-icon" />
          </div>
          <div className="ipod-card-content">
            <h2>Interactive Test Mode</h2>
            <p className="subtitle">
              Running with in-browser persistence. Test the complete attendee check-in, confirmation
              screen, host dashboard, and live raffle wheel immediately.
            </p>
            <div className="row wrap">
              <Link className="button" to="/e/nasa-space-apps">
                Test Attendee Check-In
              </Link>
              <Link className="button secondary" to="/host">
                Host Dashboard
              </Link>
              <Link className="button secondary" to="/host/projector/evt-nasa-2026">
                Projector Wheel
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="panel ipod-card">
        <div className="ipod-screen-bar">
          <span>Host Navigation</span>
          <span className="ipod-battery-icon" />
        </div>
        <div className="ipod-card-content">
          <h2>Host Controls</h2>
          <p>Manage events, download attendance workbooks, and run fair raffle drawings.</p>
          <div className="actions">
            <Link className="button" to="/host">
              Host Dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}

export function AttendeePage() {
  const params = useParams()
  const slug = params.slug ?? ''
  const [eventState, setEventState] = useState<Awaited<ReturnType<typeof getPublicEvent>>>()
  const [loading, setLoading] = useState(() => Boolean(isBackendConfigured && slug))
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [hofstraUsername, setHofstraUsername] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{ firstName: string; eventName: string } | null>(null)

  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!isBackendConfigured || !slug) return

    setLoading(true)
    getPublicEvent(slug)
      .then((event) => setEventState(event))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug])

  // Move accessible focus to confirmation heading when confirmed screen renders
  useEffect(() => {
    if (confirmed && headingRef.current) {
      headingRef.current.focus()
    }
  }, [confirmed])

  function handleUsernameChange(rawValue: string) {
    const trimmed = rawValue.trim()
    const atIndex = trimmed.indexOf('@')
    if (atIndex !== -1) {
      const candidateDomain = trimmed.slice(atIndex + 1).toLocaleLowerCase()
      if (candidateDomain === 'hofstra.edu') {
        setHofstraUsername(trimmed.slice(0, atIndex).trim())
        setUsernameError(null)
        return
      }
    }
    setHofstraUsername(rawValue)
    setUsernameError(null)
  }

  const submitDisabled =
    submitting || loading || !eventState || eventState.status !== 'open' || !eventState.registration_open

  async function onSubmit(event: FormEvent) {
    event.preventDefault()

    const validation = validateFullName(firstName, lastName)
    const emailValidation = normalizeHofstraUsername(hofstraUsername)

    setError(validation.first.message ?? validation.last.message ?? null)
    setUsernameError(
      emailValidation.ok ? null : emailValidation.message ?? 'Invalid Hofstra email username.',
    )

    if (!validation.ok || !emailValidation.ok) {
      return
    }

    if (!eventState) {
      setError('Event is unavailable.')
      return
    }

    const receiptKey = getReceiptKey(slug)
    const previous = localStorage.getItem(receiptKey)
    const parsed = previous ? JSON.parse(previous) : null
    const submissionId = parsed?.submissionId ?? crypto.randomUUID()
    const retryReceipt = parsed?.retryReceipt ?? crypto.randomUUID()

    // Save retry identifiers BEFORE network request to guarantee safe client-side idempotency
    localStorage.setItem(receiptKey, JSON.stringify({ submissionId, retryReceipt }))

    setSubmitting(true)
    setError(null)

    try {
      const response = await submitEntry(
        slug,
        validation.first.value,
        validation.last.value,
        emailValidation.username,
        submissionId,
        retryReceipt,
      )

      if (response.status === 'accepted' || response.status === 'duplicate') {
        localStorage.setItem(
          receiptKey,
          JSON.stringify({ submissionId, retryReceipt: response.receipt_id ?? retryReceipt }),
        )
        setUsernameError(null)
        setConfirmed({
          firstName: validation.first.value,
          eventName: eventState.name,
        })
        return
      }

      // Do NOT treat an unrelated duplicate-email response as a confirmed check-in
      if (response.status === 'already_checked_in' || response.status === 'duplicate_email') {
        setError('This Hofstra email is already checked in for this event.')
      } else if (response.status === 'closed') {
        setError('Registration for this event is currently closed.')
      } else if (response.status === 'ended') {
        setError('This raffle has ended.')
      } else if (response.status === 'rate_limited') {
        setError('Please wait a moment and try again.')
      } else if (response.status === 'invalid_email') {
        setUsernameError('Enter a valid Hofstra email username.')
      } else {
        setError('This event is unavailable.')
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to submit entry.'
      if (message.toLocaleLowerCase().includes('hofstra email')) {
        setUsernameError(message)
      } else {
        setError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!isBackendConfigured) {
    return (
      <main className="container narrow">
        <BackendRequiredMessage />
      </main>
    )
  }

  // 2. DEDICATED CONFIRMATION SCREEN
  if (confirmed) {
    return (
      <main className="container narrow confirmation-screen">
        <div className="panel ipod-card confirmation-card">
          <div className="ipod-screen-bar">
            <span>NASA Check-In</span>
            <span className="ipod-battery-icon" />
          </div>
          <div className="ipod-card-content confirmation-body">
            <div className="confirmation-badge" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0071e3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="confirmation-heading">
              Thank you for attending the NASA event!
            </h1>
            <p className="confirmation-greeting">
              You’re checked in, {confirmed.firstName}, and entered into the raffle.
            </p>
            <p className="confirmation-instruction">
              Watch the main screen for the drawing.
            </p>
            <p className="confirmation-dismiss">
              You can close this page.
            </p>
            <div className="confirmation-secondary">
              <span className="event-tag">Event</span>
              <span className="event-title-context">{confirmed.eventName}</span>
            </div>
            <div className="row wrap" style={{ marginTop: '0.75rem', justifyContent: 'center' }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setConfirmed(null)
                  setFirstName('')
                  setLastName('')
                  setHofstraUsername('')
                }}
              >
                Register Another Attendee
              </button>
              <Link className="button secondary" to="/">
                Home
              </Link>
              <Link className="button" to="/host">
                Host Dashboard
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const isClosed = eventState && (eventState.status === 'closed' || !eventState.registration_open)
  const isEnded = eventState?.status === 'ended'

  return (
    <main className="container narrow">
      <header className="page-header">
        <div className="ipod-status-bar">
          <span className="status-title">Event Check-In</span>
          <span className="status-time">Hofstra</span>
        </div>
        <h1>{eventState?.name ?? 'Event Check-In'}</h1>
        <p className="subtitle">Enter your name and Hofstra email to check in and join the raffle</p>
      </header>

      {loading && <p className="status-text">Loading event…</p>}
      {!loading && !eventState && <p className="state-banner warning">This QR code is invalid.</p>}
      {isClosed && (
        <p className="state-banner warning">Registration is closed for now. Please check with the host.</p>
      )}
      {isEnded && <p className="state-banner warning">This raffle is over. Thanks for joining!</p>}

      <div className="panel ipod-card">
        <div className="ipod-screen-bar">
          <span>Registration Form</span>
          <span className="ipod-battery-icon" />
        </div>
        <form onSubmit={onSubmit} className="ipod-card-content" aria-disabled={submitDisabled}>
          <label>
            First name
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={100}
              autoComplete="given-name"
              required
              disabled={submitting}
            />
          </label>

          <label>
            Last name
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={100}
              autoComplete="family-name"
              required
              disabled={submitting}
            />
          </label>

          <label>
            Hofstra email for check-in
            <div className="input-with-suffix">
              <input
                type="text"
                value={hofstraUsername}
                onChange={(e) => handleUsernameChange(e.target.value)}
                autoComplete="email"
                placeholder="aventura2"
                required
                disabled={submitting}
              />
              <span className="email-suffix">@hofstra.edu</span>
            </div>
            <small className="helper-text">Enter the part before @hofstra.edu.</small>
            {usernameError && <small className="error-text">{usernameError}</small>}
          </label>

          <button className="button primary-action" type="submit" disabled={submitDisabled}>
            {submitting ? 'Checking in…' : 'Check In & Join Raffle'}
          </button>

          <p className="privacy-note">
            Privacy: First and last names plus Hofstra email addresses are collected for event check-in
            and raffle administration. Only winning names may be displayed publicly. Email addresses
            are self-reported and not verified.
          </p>
        </form>
      </div>

      {error && <p className="state-banner error">{error}</p>}
    </main>
  )
}

export function HostDashboard() {
  const navigate = useNavigate()
  const HOST_PIN = '0828'
  const [isPinUnlocked, setIsPinUnlocked] = useState(() => {
    try {
      return sessionStorage.getItem('raffle_host_pin_unlocked') === HOST_PIN
    } catch {
      return false
    }
  })
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)

  const [sessionReady, setSessionReady] = useState(() => !supabase || !isBackendConfigured)
  const [email, setEmail] = useState('')
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [draws, setDraws] = useState<DrawRow[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [newEventName, setNewEventName] = useState('')
  const [search, setSearch] = useState('')
  const [removeWinners, setRemoveWinners] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [lastWinner, setLastWinner] = useState<string | null>(null)
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null

  function handlePinSubmit(e: FormEvent) {
    e.preventDefault()
    if (pinInput.trim() === HOST_PIN) {
      try {
        sessionStorage.setItem('raffle_host_pin_unlocked', HOST_PIN)
      } catch {
        // ignore
      }
      setIsPinUnlocked(true)
      setPinError(null)
      void refreshEvents()
    } else {
      setPinError('Incorrect PIN. Please enter the valid host PIN.')
    }
  }

  function handleLock() {
    try {
      sessionStorage.removeItem('raffle_host_pin_unlocked')
    } catch {
      // ignore
    }
    setIsPinUnlocked(false)
    setPinInput('')
  }

  const refreshEvents = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) {
      const loaded = data as EventRow[]
      setEvents(loaded)
      setSelectedEventId((prev) => prev ?? (loaded[0] ? loaded[0].id : null))
    }
  }, [])

  const refreshEventDetails = useCallback(async (eventId: string) => {
    if (!supabase) return

    // Sync any newly arrived remote check-ins from phones or Google Sheet
    await syncAllRemoteCheckIns(eventId)

    const [entriesResponse, drawsResponse] = await Promise.all([
      supabase
        .from('entries')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true }),
      supabase
        .from('draws')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false }),
    ])

    if (!entriesResponse.error && entriesResponse.data) {
      setEntries(entriesResponse.data as EntryRow[])
    }

    if (!drawsResponse.error && drawsResponse.data) {
      setDraws(drawsResponse.data as DrawRow[])
    }
  }, [])

  useEffect(() => {
    if (!supabase) return

    if (isBackendConfigured) {
      supabase.auth.getSession().finally(async () => {
        await refreshEvents()
        setSessionReady(true)
      })

      const { data } = supabase.auth.onAuthStateChange(async () => {
        await refreshEvents()
        setSessionReady(true)
      })

      return () => data.subscription.unsubscribe()
    } else {
      void refreshEvents()
      setSessionReady(true)
    }
  }, [refreshEvents])

  useEffect(() => {
    if (!selectedEventId) {
      return
    }

    void refreshEventDetails(selectedEventId)

    // Listen to live cross-device check-ins from phones via SSE
    const unsubscribeCloud = subscribeToLiveCheckIns((entry) => {
      syncIncomingEntry(entry)
      void refreshEventDetails(selectedEventId)
    })

    if (!supabase) {
      return () => {
        unsubscribeCloud()
      }
    }

    // Supabase Realtime subscription
    const channel = supabase
      .channel(`event-live-${selectedEventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entries', filter: `event_id=eq.${selectedEventId}` },
        () => {
          refreshEventDetails(selectedEventId)
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'draws', filter: `event_id=eq.${selectedEventId}` },
        () => {
          refreshEventDetails(selectedEventId)
        },
      )
      .subscribe()

    // Active sync poll every 3s to guarantee cross-device delivery
    const interval = setInterval(() => {
      refreshEventDetails(selectedEventId)
    }, 3000)

    const handleSync = () => {
      refreshEventDetails(selectedEventId)
    }
    window.addEventListener('storage', handleSync)
    window.addEventListener('raffle_demo_change', handleSync)

    return () => {
      channel.unsubscribe()
      unsubscribeCloud()
      clearInterval(interval)
      window.removeEventListener('storage', handleSync)
      window.removeEventListener('raffle_demo_change', handleSync)
    }
  }, [selectedEventId, refreshEventDetails])

  const duplicateIds = useMemo(() => findDuplicateNameIds(entries), [entries])

  const filteredEntries = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    if (!needle) return entries
    return entries.filter((entry) =>
      `${entry.first_name} ${entry.last_name} ${entry.hofstra_email}`.toLocaleLowerCase().includes(needle),
    )
  }, [entries, search])

  const entryLink = selectedEvent
    ? `${window.location.origin}${window.location.pathname}#/e/${selectedEvent.slug}`
    : ''

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!entryLink) return

    QRCode.toDataURL(entryLink, {
      margin: 2,
      width: 280,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#1c1c1e',
        light: '#ffffff',
      },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [entryLink])

  async function onSignIn() {
    if (!supabase) return
    const redirectUrl = window.location.origin + window.location.pathname
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectUrl },
    })
    setAuthMessage(error ? error.message : 'Check your email for the sign-in link.')
  }

  async function onSignOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setSelectedEventId(null)
    setEntries([])
    setDraws([])
  }

  async function onCreateEvent(event: FormEvent) {
    event.preventDefault()
    if (!newEventName.trim()) return
    await createEvent(newEventName)
    setNewEventName('')
    await refreshEvents()
  }

  async function onToggleEligibility(entryId: string, ineligible: boolean) {
    if (!selectedEventId) return
    await setEntryIneligible(selectedEventId, entryId, ineligible)
    await refreshEventDetails(selectedEventId)
  }

  async function onDeleteAllEntries() {
    if (!selectedEventId) return
    if (
      !window.confirm(
        'Delete ALL attendee records for this event? This will clear the attendance list and reset the spinning wheel so you can start fresh.',
      )
    ) {
      return
    }

    await clearEventCloudSync(selectedEventId)
    await clearEntries(selectedEventId)
    await refreshEventDetails(selectedEventId)
  }

  async function onDeleteEntry(entryId: string) {
    if (!selectedEventId) return
    if (window.confirm('Permanently delete this attendee record? This cannot be undone.')) {
      await deleteEntryRecord(selectedEventId, entryId)
      await refreshEventDetails(selectedEventId)
    }
  }

  async function onDownloadExcel() {
    if (!selectedEvent) return
    setExporting(true)
    try {
      // Pull latest check-ins across devices first
      await syncAllRemoteCheckIns(selectedEvent.id)

      // Ensure we export all attendance records for the selected event, not just the search view
      let exportList = entries
      if (supabase) {
        const { data } = await supabase
          .from('entries')
          .select('*')
          .eq('event_id', selectedEvent.id)
          .order('created_at', { ascending: true })
        if (data) {
          exportList = data as EntryRow[]
        }
      }
      await downloadAttendanceExcel(selectedEvent.name, selectedEvent.slug, exportList)
    } catch (err) {
      alert(`Excel export failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setExporting(false)
    }
  }

  const GOOGLE_SHEET_EDIT_URL =
    'https://docs.google.com/spreadsheets/d/1XKZnZHX7WbtJMw4T8a822920Y__x5fiuqTsxYo3fs4I/edit?usp=sharing'
  const GOOGLE_SHEET_GVIZ_URL =
    'https://docs.google.com/spreadsheets/d/1XKZnZHX7WbtJMw4T8a822920Y__x5fiuqTsxYo3fs4I/gviz/tq?tqx=out:json'

  const [sheetSyncing, setSheetSyncing] = useState(false)
  const [sheetNotice, setSheetNotice] = useState<string | null>(null)

  async function onCopyForGoogleSheet() {
    if (!selectedEvent) return
    let exportList = entries
    if (supabase) {
      const { data } = await supabase
        .from('entries')
        .select('*')
        .eq('event_id', selectedEvent.id)
        .order('created_at', { ascending: true })
      if (data) exportList = data as EntryRow[]
    }

    const lines = [
      ['Event', 'First Name', 'Last Name', 'Hofstra Email', 'Check-in Time (UTC)'].join('\t'),
      ...exportList.map((e) =>
        [
          selectedEvent.name,
          e.first_name,
          e.last_name,
          e.hofstra_email,
          e.checked_in_at ? new Date(e.checked_in_at).toISOString() : new Date().toISOString(),
        ].join('\t'),
      ),
    ]

    await navigator.clipboard.writeText(lines.join('\n'))
    setSheetNotice('Copied table data to clipboard! You can paste directly into the Google Sheet.')
    setTimeout(() => setSheetNotice(null), 5000)
  }

  async function onSyncFromGoogleSheet() {
    if (!selectedEvent) return
    setSheetSyncing(true)
    setSheetNotice(null)
    try {
      const res = await fetch(GOOGLE_SHEET_GVIZ_URL)
      const text = await res.text()
      const jsonStr = text.replace(/^[^{]*/, '').replace(/[^}]*$/, '')
      const data = JSON.parse(jsonStr)
      const rows = data?.table?.rows ?? []

      let imported = 0
      for (const row of rows) {
        const c = row.c ?? []
        const v0 = c[0]?.v ? String(c[0].v).trim() : ''
        const v1 = c[1]?.v ? String(c[1].v).trim() : ''
        const v2 = c[2]?.v ? String(c[2].v).trim() : ''
        const v3 = c[3]?.v ? String(c[3].v).trim() : ''

        if (
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
          const username = emailVal.ok ? emailVal.username : email.split('@')[0]
          try {
            await submitEntry(
              selectedEvent.slug,
              first,
              last || 'Guest',
              username,
              crypto.randomUUID(),
              crypto.randomUUID(),
            )
            imported++
          } catch {
            // skip duplicates
          }
        }
      }
      await refreshEventDetails(selectedEvent.id)
      setSheetNotice(
        imported > 0
          ? `Synced ${imported} attendee(s) from Google Sheet!`
          : 'Google Sheet is currently empty or attendees are already registered.',
      )
    } catch (err) {
      setSheetNotice(
        `Failed to read Google Sheet: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    } finally {
      setSheetSyncing(false)
      setTimeout(() => setSheetNotice(null), 5000)
    }
  }

  async function onDraw() {
    if (!selectedEventId || drawing) return

    setDrawing(true)
    setLastWinner(null)

    try {
      const result = await runDraw(selectedEventId, crypto.randomUUID(), removeWinners)
      if (result?.status === 'empty') {
        setLastWinner('No eligible participants remain.')
      } else if (result?.winner_first_name) {
        setLastWinner(`${result.winner_first_name} ${result.winner_last_name}`)
      }
      await refreshEventDetails(selectedEventId)
    } catch (err) {
      setLastWinner(`Draw failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setDrawing(false)
    }
  }

  if (!isPinUnlocked) {
    return (
      <main className="container narrow host-pin-screen">
        <div className="panel ipod-card">
          <div className="ipod-screen-bar">
            <span>Host Security</span>
            <span className="ipod-battery-icon" />
          </div>
          <div className="ipod-card-content">
            <div className="ipod-logo-badge"> iPod Host Controls</div>
            <h2>Host Access</h2>
            <p className="subtitle">
              Enter the Host PIN to access event management and private attendance records.
            </p>
            <form onSubmit={handlePinSubmit} className="pin-form">
              <label htmlFor="host-pin-input" className="form-label">
                Host PIN
              </label>
              <input
                id="host-pin-input"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value)
                  setPinError(null)
                }}
                placeholder="••••"
                className="input pin-input"
                autoFocus
              />
              {pinError && <p className="field-error" role="alert">{pinError}</p>}
              <div className="row" style={{ marginTop: '0.75rem' }}>
                <button className="button primary full-width" type="submit">
                  Unlock Dashboard
                </button>
              </div>
            </form>
          </div>
        </div>
        <p className="footer-note" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <Link to="/" className="link">← Return to Home</Link>
        </p>
      </main>
    )
  }

  if (!sessionReady) {
    return (
      <main className="container narrow">
        <p className="status-text">Loading host dashboard…</p>
      </main>
    )
  }

  return (
    <main className="container host-layout">
      <header className="host-header">
        <div>
          <div className="ipod-status-bar">
            <span className="status-title">Host Controls</span>
            <span className="status-time">PIN 0828 Authenticated</span>
          </div>
          <h1>Host Dashboard</h1>
          <p className="subtitle">Manage raffle events and attendance records</p>
        </div>
        <div className="row wrap">
          <button className="button secondary" type="button" onClick={handleLock}>
            🔒 Lock
          </button>
          <Link className="button secondary" to="/">
            Home
          </Link>
        </div>
      </header>

      <section className="panel ipod-card">
        <div className="ipod-screen-bar">
          <span>Host Authentication</span>
          <span className="ipod-battery-icon" />
        </div>
        <div className="ipod-card-content">
          <h2>Host Authentication</h2>
          <div className="row wrap">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="host@example.edu"
            />
            <button className="button" type="button" onClick={onSignIn}>
              Send Sign-In Link
            </button>
            <button className="button secondary" type="button" onClick={onSignOut}>
              Sign Out
            </button>
          </div>
          {authMessage && <p className="status-note">{authMessage}</p>}
        </div>
      </section>

      <section className="panel ipod-card">
        <div className="ipod-screen-bar">
          <span>New Event</span>
          <span className="ipod-battery-icon" />
        </div>
        <div className="ipod-card-content">
          <h2>Create Event</h2>
          <form className="row wrap" onSubmit={onCreateEvent}>
            <input
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              placeholder="Event Name (e.g. NASA Tech Expo)"
              required
            />
            <button className="button" type="submit">
              Create Event
            </button>
          </form>
        </div>
      </section>

      <section className="panel ipod-card">
        <div className="ipod-screen-bar">
          <span>Event Library</span>
          <span className="ipod-battery-icon" />
        </div>
        <div className="ipod-card-content">
          <h2>Your Events</h2>
          {events.length === 0 ? (
            <p className="empty-text">No events created yet.</p>
          ) : (
            <div className="event-grid">
              {events.map((event) => (
                <button
                  key={event.id}
                  className={`event-card ${selectedEventId === event.id ? 'active' : ''}`}
                  onClick={() => setSelectedEventId(event.id)}
                  type="button"
                >
                  <strong>{event.name}</strong>
                  <span className={`status-badge status-${event.status}`}>{event.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedEvent && (
        <>
          <section className="panel ipod-card two-col">
            <div>
              <div className="ipod-screen-bar">
                <span>Event Entry & QR</span>
                <span className="ipod-battery-icon" />
              </div>
              <div className="ipod-card-content">
                <div className="row wrap space-between align-center">
                  <h2>Entry Link & QR Code</h2>
                  <span className="sync-badge">● LIVE CLOUD SYNC CONNECTED</span>
                </div>
                <p className="mono-link">{entryLink}</p>
                <div className="row wrap">
                  <button
                    className="button"
                    type="button"
                    onClick={() => navigator.clipboard.writeText(entryLink)}
                  >
                    Copy Link
                  </button>
                  <a
                    className="button secondary"
                    href={qrDataUrl ?? '#'}
                    download={`${selectedEvent.slug}-qr.png`}
                  >
                    Download QR
                  </a>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => navigate(`/host/projector/${selectedEvent.id}`)}
                  >
                    Projector Mode
                  </button>
                  <button
                    className="button export-action"
                    type="button"
                    onClick={onDownloadExcel}
                    disabled={exporting}
                  >
                    {exporting ? 'Exporting…' : 'Download Excel'}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={onSyncFromGoogleSheet}
                    disabled={sheetSyncing}
                  >
                    {sheetSyncing ? 'Syncing…' : 'Sync Google Sheet'}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={onCopyForGoogleSheet}
                  >
                    Copy for Sheet
                  </button>
                  <a
                    className="button secondary"
                    href={GOOGLE_SHEET_EDIT_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Google Sheet
                  </a>
                </div>
                {sheetNotice && <p className="status-note">{sheetNotice}</p>}
              </div>
            </div>
            <div className="qr-wrap">
              {qrDataUrl && <img src={qrDataUrl} alt={`QR code for ${selectedEvent.name}`} />}
            </div>
          </section>

          <section className="panel ipod-card">
            <div className="ipod-screen-bar">
              <span>Event State & Lifecycle</span>
              <span className="ipod-battery-icon" />
            </div>
            <div className="ipod-card-content">
              <h2>Event Controls</h2>
              <div className="row wrap">
                <button
                  className="button"
                  type="button"
                  onClick={() => setRegistration(selectedEvent.id, true)}
                >
                  Open Registration
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setRegistration(selectedEvent.id, false)}
                >
                  Close Registration
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => endEvent(selectedEvent.id)}
                >
                  End Event
                </button>
                <button
                  className="button danger"
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Clear all entries for this event? All attendance records will be removed.',
                      )
                    ) {
                      clearEntries(selectedEvent.id).then(() => refreshEventDetails(selectedEvent.id))
                    }
                  }}
                >
                  Clear Entries
                </button>
                <button
                  className="button danger"
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Delete this event and all its data? This action cannot be undone.',
                      )
                    ) {
                      deleteEventData(selectedEvent.id).then(() => {
                        setSelectedEventId(null)
                        refreshEvents()
                      })
                    }
                  }}
                >
                  Delete Event Data
                </button>
              </div>
            </div>
          </section>

          <section className="panel ipod-card">
            <div className="ipod-screen-bar">
              <span>Drawing Controls</span>
              <span className="ipod-battery-icon" />
            </div>
            <div className="ipod-card-content">
              <h2>Raffle Drawing</h2>
              <div className="row wrap">
                <label className="inline-control">
                  <input
                    type="checkbox"
                    checked={removeWinners}
                    onChange={(e) => {
                      setRemoveWinners(e.target.checked)
                      localStorage.setItem(
                        getPreferenceKey(selectedEvent.id, 'removeWinners'),
                        e.target.checked ? '1' : '0',
                      )
                    }}
                  />
                  Remove winners from future draws
                </label>
                <button className="button primary-action" type="button" onClick={onDraw} disabled={drawing}>
                  {drawing ? 'Drawing…' : 'Run Draw'}
                </button>
              </div>
              {lastWinner && <p className="winner-callout">{lastWinner}</p>}
              <div className="draw-history">
                <h3>Drawing History</h3>
                {draws.length === 0 ? (
                  <p className="empty-text">No drawings conducted yet.</p>
                ) : (
                  <ol className="draw-list">
                    {draws.map((draw) => (
                      <li key={draw.id}>
                        <span className="draw-time">{new Date(draw.created_at).toLocaleString()}</span>
                        <strong className="draw-winner">
                          {draw.winner_first_name
                            ? `${draw.winner_first_name} ${draw.winner_last_name}`
                            : 'No eligible winner'}
                        </strong>
                        {draw.remove_winner && <em className="tag-removed">removed from future</em>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </section>

          <section className="panel ipod-card">
            <div className="ipod-screen-bar">
              <span>Attendance Records</span>
              <span className="ipod-battery-icon" />
            </div>
            <div className="ipod-card-content">
              <div className="section-header-row">
                <h2>Attendance & Participants ({entries.length})</h2>
                <div className="row wrap">
                  <button
                    className="button danger"
                    type="button"
                    onClick={onDeleteAllEntries}
                    disabled={entries.length === 0}
                  >
                    Delete All
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={onDownloadExcel}
                    disabled={exporting}
                  >
                    {exporting ? 'Exporting…' : 'Download Excel (.xlsx)'}
                  </button>
                </div>
              </div>
              <input
                className="search-input"
                placeholder="Search by name or Hofstra email…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {filteredEntries.length === 0 ? (
                <p className="empty-text">No participants match the search.</p>
              ) : (
                <ul className="entry-list">
                  {filteredEntries.map((entry) => (
                    <li key={entry.id} className={entry.ineligible ? 'entry-ineligible' : ''}>
                      <div className="entry-info">
                        <strong>
                          {entry.first_name} {entry.last_name}
                        </strong>
                        <span className="entry-email">{entry.hofstra_email}</span>
                        <span className="entry-meta">
                          Checked in:{' '}
                          {entry.checked_in_at
                            ? new Date(entry.checked_in_at).toLocaleString()
                            : 'Unknown'}
                        </span>
                        {duplicateIds.has(entry.id) && (
                          <span className="badge-warning">Matching name on file</span>
                        )}
                        {entry.ineligible && (
                          <span className="badge-excluded">Excluded from raffle</span>
                        )}
                      </div>
                      <div className="entry-actions">
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => onToggleEligibility(entry.id, !entry.ineligible)}
                        >
                          {entry.ineligible ? 'Re-admit' : 'Exclude'}
                        </button>
                        <button
                          className="button danger-text"
                          type="button"
                          onClick={() => onDeleteEntry(entry.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

export function ProjectorModePage() {
  const params = useParams()
  const eventId = params.eventId ?? ''
  const [eventData, setEventData] = useState<EventRow | null>(null)
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [draw, setDraw] = useState<DrawRow | null>(null)
  const [rotation, setRotation] = useState(0)
  const [showQr, setShowQr] = useState(true)
  const [playSound, setPlaySound] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [recentAttendee, setRecentAttendee] = useState<string | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null)

  const reloadEntries = useCallback(() => {
    if (!supabase || !eventId) return
    void syncAllRemoteCheckIns(eventId).then(() => {
      if (!supabase) return
      supabase
        .from('entries')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true })
        .then(({ data }: { data: any }) => {
          if (data) setEntries(data as EntryRow[])
        })
      supabase
        .from('draws')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }: { data: any }) => {
          if (data) setDraw(data as DrawRow)
        })
    })
  }, [eventId])

  const handleManualRefresh = async () => {
    if (!eventId || refreshing) return
    setRefreshing(true)
    setRefreshNotice(null)
    try {
      await syncAllRemoteCheckIns(eventId)
      reloadEntries()
      setRefreshNotice('Refreshed!')
      setTimeout(() => setRefreshNotice(null), 3000)
    } finally {
      setRefreshing(false)
    }
  }

  // Load event details and real QR code
  useEffect(() => {
    if (!supabase || !eventId) return

    supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        if (data) {
          const loaded = data as EventRow
          setEventData(loaded)
          const url = `${window.location.origin}${window.location.pathname}#/e/${loaded.slug}`
          QRCode.toDataURL(url, {
            margin: 2,
            width: 320,
            errorCorrectionLevel: 'H',
            color: { dark: '#1c1c1e', light: '#ffffff' },
          })
            .then(setQrDataUrl)
            .catch(() => setQrDataUrl(null))
        }
      })

    // Initial load
    reloadEntries()

    // Subscribe to live cross-device check-ins from phones via SSE
    const unsubscribeCloud = subscribeToLiveCheckIns((entry) => {
      syncIncomingEntry(entry)
      setRecentAttendee(`${entry.first_name} ${entry.last_name}`)
      setTimeout(() => setRecentAttendee(null), 5000)
      reloadEntries()
    })

    // Subscribe to new draws via Supabase
    const channel = supabase
      .channel(`projector-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'draws', filter: `event_id=eq.${eventId}` },
        (payload: any) => {
          setDraw(payload.new as DrawRow)
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entries', filter: `event_id=eq.${eventId}` },
        () => {
          reloadEntries()
        },
      )
      .subscribe()

    const interval = setInterval(reloadEntries, 2500)
    window.addEventListener('storage', reloadEntries)
    window.addEventListener('raffle_demo_change', reloadEntries)

    return () => {
      channel.unsubscribe()
      unsubscribeCloud()
      clearInterval(interval)
      window.removeEventListener('storage', reloadEntries)
      window.removeEventListener('raffle_demo_change', reloadEntries)
    }
  }, [eventId])

  // Determine the active participant list for the wheel:
  // Use the draw's immutable snapshot if available, or current eligible entries
  const wheelParticipants = useMemo(() => {
    if (draw?.snapshot?.length) {
      return draw.snapshot
    }
    return entries.filter((e) => !e.ineligible)
  }, [draw, entries])

  useEffect(() => {
    if (!draw?.snapshot?.length || !draw.winner_entry_id) return
    const index = draw.snapshot.findIndex((entry) => entry.id === draw.winner_entry_id)
    if (index >= 0) {
      const targetRotation = computeWheelRotation(index, draw.snapshot.length)
      setRotation(targetRotation)

      if (playSound) {
        const audio = new Audio(
          'data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YRAAAAAA',
        )
        void audio.play().catch(() => undefined)
      }
    }
  }, [draw, playSound])

  // Generate dynamic iPod-inspired wheel background colors corresponding to real entries
  const wheelBackground = useMemo(() => {
    const count = wheelParticipants.length
    if (count <= 0) {
      return '#e5e5ea'
    }
    // For large lists (> 36), use a neat 12-segment motif to avoid visual clutter
    const segmentCount = count > 36 ? 12 : count
    const colors = [
      '#d1d5db',
      '#93c5fd',
      '#cbd5e1',
      '#bfdbfe',
      '#e2e8f0',
      '#60a5fa',
      '#e5e7eb',
      '#3b82f6',
    ]

    const sliceAngle = 360 / segmentCount
    const stops: string[] = []
    for (let i = 0; i < segmentCount; i++) {
      const color = colors[i % colors.length]
      stops.push(`${color} ${i * sliceAngle}deg ${(i + 1) * sliceAngle}deg`)
    }
    return `conic-gradient(${stops.join(', ')})`
  }, [wheelParticipants])

  async function onSpinProjectorWheel() {
    if (!eventId || wheelParticipants.length === 0 || spinning) return
    setSpinning(true)
    try {
      const res = await runDraw(eventId, crypto.randomUUID(), true)
      if (res?.winner_first_name) {
        // Updated draw triggers rotation animation via listener
        if (!supabase) return
        supabase
          .from('draws')
          .select('*')
          .eq('event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }: { data: any }) => {
            if (data) setDraw(data as DrawRow)
          })
      }
    } catch (err) {
      alert(`Drawing failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSpinning(false)
    }
  }

  const winnerName = draw?.winner_first_name
    ? `${draw.winner_first_name} ${draw.winner_last_name}`
    : 'Waiting for drawing…'

  return (
    <main className="container projector">
      <header className="host-header">
        <div>
          <div className="ipod-status-bar">
            <span className="status-title">Projector Display</span>
            <span className="status-time">Live Drawing</span>
          </div>
          <h1>{eventData?.name ?? 'Projector Mode'}</h1>
          <p className="subtitle">Live Raffle Drawing</p>
        </div>
        <Link className="button secondary" to="/host">
          Back to Host
        </Link>
      </header>

      <div className="row wrap controls-bar align-center">
        <button
          className="button secondary refresh-btn"
          type="button"
          onClick={handleManualRefresh}
          disabled={refreshing}
          title="Refresh entries from registration form"
        >
          {refreshing ? 'Refreshing…' : '🔄 Refresh'}
        </button>
        {refreshNotice && <span className="sync-badge">✓ {refreshNotice}</span>}
        <label className="inline-control">
          <input
            type="checkbox"
            checked={showQr}
            onChange={(event) => setShowQr(event.target.checked)}
          />{' '}
          Show QR Panel
        </label>
        <label className="inline-control">
          <input
            type="checkbox"
            checked={playSound}
            onChange={(event) => setPlaySound(event.target.checked)}
          />{' '}
          Play Audio Tone
        </label>
      </div>

      <section className="projector-grid">
        <div className="wheel-shell" aria-live="polite">
          {recentAttendee && (
            <div className="live-checkin-banner">
              ✨ {recentAttendee} just checked in!
            </div>
          )}
          <div className="pointer" />
          <div
            className="wheel"
            style={{
              transform: `rotate(${rotation}deg)`,
              background: wheelBackground,
            }}
          >
            {wheelParticipants.length > 0 && wheelParticipants.length <= 24 && (
              <svg className="wheel-svg" viewBox="-200 -200 400 400">
                {wheelParticipants.map((p, idx) => {
                  const sliceAngle = 360 / wheelParticipants.length
                  const midAngle = idx * sliceAngle + sliceAngle / 2
                  const label = `${p.first_name} ${p.last_name ? p.last_name[0] + '.' : ''}`
                  return (
                    <g key={p.id || idx} transform={`rotate(${midAngle})`}>
                      <text
                        x="170"
                        y="5"
                        textAnchor="end"
                        fill="#1c1c1e"
                        fontSize={wheelParticipants.length > 12 ? '11px' : '13px'}
                        fontWeight="700"
                      >
                        {label}
                      </text>
                    </g>
                  )
                })}
              </svg>
            )}
            <div className="wheel-center" />
          </div>
          {wheelParticipants.length > 36 && (
            <p className="large-list-note">
              Visual simplification enabled for large entry list ({wheelParticipants.length}{' '}
              participants). Winner selection is server-authoritative and unbiased.
            </p>
          )}

          <button
            className="button primary spin-projector-btn"
            type="button"
            onClick={onSpinProjectorWheel}
            disabled={spinning || wheelParticipants.length === 0}
          >
            {spinning ? 'Spinning Wheel…' : '🎲 Spin The Wheel'}
          </button>
        </div>

        {showQr && (
          <aside className="panel ipod-card projector-qr-panel">
            <div className="ipod-screen-bar">
              <span>Entry QR Code</span>
              <span className="ipod-battery-icon" />
            </div>
            <div className="ipod-card-content">
              <h2>Scan to Join</h2>
              <div className="qr-wrap">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt={`QR code for ${eventData?.name ?? 'event'}`} />
                ) : (
                  <p>Generating QR code…</p>
                )}
              </div>
              <p className="qr-hint">Scan with your camera to open check-in.</p>
            </div>
          </aside>
        )}
      </section>

      <div className="winner-announcement">
        <span className="winner-label">Winner</span>
        <h2 className="winner-banner">{winnerName}</h2>
        <p className="participant-summary">
          Eligible participants in draw snapshot: {draw?.snapshot_size ?? wheelParticipants.length}
        </p>
      </div>

      <div className="attendee-roster panel ipod-card">
        <div className="ipod-screen-bar">
          <span>Current Wheel Entries ({wheelParticipants.length})</span>
          <span className="live-dot-pulse">● LIVE SYNC</span>
        </div>
        <div className="ipod-card-content">
          <div className="roster-tags">
            {wheelParticipants.length === 0 ? (
              <p className="status-note">Waiting for attendees to scan QR code and check in…</p>
            ) : (
              wheelParticipants.map((p) => (
                <span key={p.id} className="roster-tag">
                  {p.first_name} {p.last_name}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/e/:slug" element={<AttendeePage />} />
        <Route path="/host" element={<HostDashboard />} />
        <Route path="/host/projector/:eventId" element={<ProjectorModePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
