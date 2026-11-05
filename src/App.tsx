import { useEffect, useMemo, useState } from 'react'
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
  deleteEventData,
  endEvent,
  getPublicEvent,
  removeEntry,
  runDraw,
  setRegistration,
  submitEntry,
} from './lib/api'
import { isBackendConfigured } from './lib/env'
import { findDuplicateNameIds } from './lib/duplicates'
import { getPreferenceKey, getReceiptKey } from './lib/storage'
import { supabase } from './lib/supabase'
import { normalizeHofstraUsername } from './lib/hofstraEmail'
import { validateFullName } from './lib/validation'
import { computeWheelRotation } from './lib/wheel'

type EventRow = {
  id: string
  name: string
  slug: string
  status: 'open' | 'closed' | 'ended'
  registration_open: boolean
  created_at: string
}

type EntryRow = {
  id: string
  event_id: string
  first_name: string
  last_name: string
  hofstra_email: string
  checked_in_at: string | null
  ineligible: boolean
  created_at: string
}

type DrawRow = {
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
    <div className="panel">
      <h2>Backend setup required</h2>
      <p>
        This app is intentionally disabled until Supabase credentials are configured.
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
      </p>
    </div>
  )
}

function HomePage() {
  return (
    <main className="container">
      <h1>QR Raffle Wheel</h1>
      <p>Anonymous event check-in with first name, last name, and Hofstra email username.</p>
      {!isBackendConfigured && <BackendRequiredMessage />}
      <div className="actions">
        <Link className="button" to="/host">
          Host dashboard
        </Link>
      </div>
    </main>
  )
}

function AttendeePage() {
  const params = useParams()
  const slug = params.slug ?? ''
  const [eventState, setEventState] = useState<Awaited<ReturnType<typeof getPublicEvent>>>()
  const [loading, setLoading] = useState(true)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [hofstraUsername, setHofstraUsername] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!isBackendConfigured || !slug) {
      setLoading(false)
      return
    }

    setLoading(true)
    getPublicEvent(slug)
      .then((event) => setEventState(event))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug])

  const submitDisabled = submitting || loading || !eventState || eventState.status !== 'open' || !eventState.registration_open

  async function onSubmit(event: FormEvent) {
    event.preventDefault()

    const validation = validateFullName(firstName, lastName)
    const emailValidation = normalizeHofstraUsername(hofstraUsername)

    setError(validation.first.message ?? validation.last.message ?? null)
    setUsernameError(emailValidation.ok ? null : (emailValidation.message ?? 'Invalid Hofstra email username.'))

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

    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await submitEntry(
        slug,
        validation.first.value,
        validation.last.value,
        emailValidation.username,
        submissionId,
        retryReceipt,
      )

      if (response.status === 'accepted' || response.status === 'duplicate' || response.status === 'already_checked_in') {
        localStorage.setItem(
          receiptKey,
          JSON.stringify({ submissionId, retryReceipt: response.receipt_id ?? retryReceipt }),
        )
        setUsernameError(null)
        if (response.status === 'already_checked_in') {
          setSuccess('This Hofstra email is already checked in for this event.')
        } else {
          setSuccess(`You're in, ${validation.first.value}! Watch the main screen for the drawing.`)
        }
        return
      }

      if (response.status === 'closed') {
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
      <main className="container">
        <BackendRequiredMessage />
      </main>
    )
  }

  const isClosed = eventState && (eventState.status === 'closed' || !eventState.registration_open)
  const isEnded = eventState?.status === 'ended'

  return (
    <main className="container narrow">
      <h1>Join raffle</h1>
      {loading && <p>Loading event…</p>}
      {!loading && !eventState && <p className="state-banner">This QR code is invalid.</p>}
      {isClosed && <p className="state-banner">Registration is closed for now. Please check with the host.</p>}
      {isEnded && <p className="state-banner">This raffle is over. Thanks for joining!</p>}

      <form onSubmit={onSubmit} className="panel" aria-disabled={submitDisabled}>
        <label>
          First name
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={100}
            autoComplete="given-name"
            required
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
          />
        </label>

        <label>
          Hofstra email for check-in
          <div className="input-with-suffix">
            <input
              type="text"
              value={hofstraUsername}
              onChange={(e) => {
                const rawValue = e.target.value
                const trimmed = rawValue.trim()
                const atCount = (trimmed.match(/@/g) ?? []).length
                if (atCount === 1 && trimmed.toLocaleLowerCase().endsWith('@hofstra.edu')) {
                  setHofstraUsername(trimmed.slice(0, trimmed.length - '@hofstra.edu'.length))
                } else {
                  setHofstraUsername(rawValue)
                }
              }}
              autoComplete="email"
              placeholder="aventura2"
              required
            />
            <span>@hofstra.edu</span>
          </div>
          <small className="helper-text">Enter the part before @hofstra.edu.</small>
          {usernameError && <small className="error">{usernameError}</small>}
        </label>

        <button className="button" type="submit" disabled={submitDisabled}>
          {submitting ? 'Checking in…' : 'Check In & Join Raffle'}
        </button>

        <p className="privacy-note">
          Privacy: first and last names plus Hofstra email addresses are collected for event check-in and raffle administration. Only winning names may be displayed publicly.
        </p>
      </form>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
    </main>
  )
}

function HostDashboard() {
  const navigate = useNavigate()
  const [sessionReady, setSessionReady] = useState(false)
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
  const [lastWinner, setLastWinner] = useState<string | null>(null)
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null

  async function refreshEvents() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) {
      const loaded = data as EventRow[]
      setEvents(loaded)
      if (!selectedEventId && loaded[0]) {
        setSelectedEventId(loaded[0].id)
      }
    }
  }

  async function refreshEventDetails(eventId: string) {
    if (!supabase) return

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
  }

  useEffect(() => {
    if (!supabase || !isBackendConfigured) {
      setSessionReady(true)
      return
    }

    supabase.auth.getSession().finally(async () => {
      await refreshEvents()
      setSessionReady(true)
    })

    const { data } = supabase.auth.onAuthStateChange(async () => {
      await refreshEvents()
      setSessionReady(true)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!selectedEventId) {
      setEntries([])
      setDraws([])
      return
    }

    refreshEventDetails(selectedEventId)

    if (!supabase) return

    const channel = supabase
      .channel(`event-live-${selectedEventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries', filter: `event_id=eq.${selectedEventId}` }, () => {
        refreshEventDetails(selectedEventId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draws', filter: `event_id=eq.${selectedEventId}` }, () => {
        refreshEventDetails(selectedEventId)
      })
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [selectedEventId])

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
    if (!entryLink) {
      setQrDataUrl(null)
      return
    }

    QRCode.toDataURL(entryLink, {
      margin: 4,
      width: 280,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [entryLink])

  async function onSignIn() {
    if (!supabase) return
    const { error } = await supabase.auth.signInWithOtp({ email })
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
    } finally {
      setDrawing(false)
    }
  }

  if (!isBackendConfigured) {
    return (
      <main className="container">
        <BackendRequiredMessage />
      </main>
    )
  }

  if (!sessionReady) {
    return (
      <main className="container">
        <p>Loading host dashboard…</p>
      </main>
    )
  }

  return (
    <main className="container host-layout">
      <header className="host-header">
        <h1>Host Dashboard</h1>
        <Link to="/">Back</Link>
      </header>

      <section className="panel">
        <h2>Host authentication</h2>
        <div className="row">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="host@example.edu"
          />
          <button className="button" type="button" onClick={onSignIn}>
            Send sign-in link
          </button>
          <button className="button secondary" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
        {authMessage && <p>{authMessage}</p>}
      </section>

      <section className="panel">
        <h2>Create event</h2>
        <form className="row" onSubmit={onCreateEvent}>
          <input
            value={newEventName}
            onChange={(e) => setNewEventName(e.target.value)}
            placeholder="Campus Festival Raffle"
            required
          />
          <button className="button" type="submit">
            Create
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Your events</h2>
        <div className="event-grid">
          {events.map((event) => (
            <button
              key={event.id}
              className={`event-card ${selectedEventId === event.id ? 'active' : ''}`}
              onClick={() => setSelectedEventId(event.id)}
              type="button"
            >
              <strong>{event.name}</strong>
              <span>{event.status}</span>
            </button>
          ))}
        </div>
      </section>

      {selectedEvent && (
        <>
          <section className="panel two-col">
            <div>
              <h2>Entry link & QR</h2>
              <p className="mono">{entryLink}</p>
              <div className="row">
                <button className="button" onClick={() => navigator.clipboard.writeText(entryLink)}>
                  Copy link
                </button>
                <a className="button secondary" href={qrDataUrl ?? '#'} download={`${selectedEvent.slug}.png`}>
                  Download QR
                </a>
                <button className="button secondary" type="button" onClick={() => navigate(`/host/projector/${selectedEvent.id}`)}>
                  Projector mode
                </button>
              </div>
            </div>
            <div className="qr-wrap">{qrDataUrl && <img src={qrDataUrl} alt={`QR code for ${selectedEvent.name}`} />}</div>
          </section>

          <section className="panel">
            <h2>Controls</h2>
            <div className="row wrap">
              <button className="button" onClick={() => setRegistration(selectedEvent.id, true)}>
                Open registration
              </button>
              <button className="button secondary" onClick={() => setRegistration(selectedEvent.id, false)}>
                Close registration
              </button>
              <button className="button secondary" onClick={() => endEvent(selectedEvent.id)}>
                End event
              </button>
              <button
                className="button danger"
                onClick={() => {
                  if (window.confirm('Clear all entries for this event?')) {
                    clearEntries(selectedEvent.id).then(() => refreshEventDetails(selectedEvent.id))
                  }
                }}
              >
                Clear entries
              </button>
              <button
                className="button danger"
                onClick={() => {
                  if (window.confirm('Delete this event and its data? This cannot be undone.')) {
                    deleteEventData(selectedEvent.id).then(() => {
                      setSelectedEventId(null)
                      refreshEvents()
                    })
                  }
                }}
              >
                Delete event data
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>Draw</h2>
            <div className="row wrap">
              <label className="inline-control">
                <input
                  type="checkbox"
                  checked={removeWinners}
                  onChange={(e) => {
                    setRemoveWinners(e.target.checked)
                    localStorage.setItem(getPreferenceKey(selectedEvent.id, 'removeWinners'), e.target.checked ? '1' : '0')
                  }}
                />
                Remove winners from future draws
              </label>
              <button className="button" onClick={onDraw} disabled={drawing}>
                {drawing ? 'Drawing…' : 'Run draw'}
              </button>
            </div>
            {lastWinner && <p className="success">Winner: {lastWinner}</p>}
            <ol>
              {draws.map((draw) => (
                <li key={draw.id}>
                  {new Date(draw.created_at).toLocaleString()} —{' '}
                  {draw.winner_first_name ? `${draw.winner_first_name} ${draw.winner_last_name}` : 'No winner'}
                  {draw.remove_winner ? ' (removed)' : ''}
                </li>
              ))}
            </ol>
          </section>

          <section className="panel">
            <h2>
              Participants ({entries.length})
            </h2>
            <input
              placeholder="Search participants"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <ul className="entry-list">
              {filteredEntries.map((entry) => (
                <li key={entry.id}>
                  <span>
                    {entry.first_name} {entry.last_name} — {entry.hofstra_email}
                    <em> (checked in {entry.checked_in_at ? new Date(entry.checked_in_at).toLocaleString() : 'unknown time'})</em>
                    {duplicateIds.has(entry.id) && <em> (name matches another entry)</em>}
                    {entry.ineligible && <em> (ineligible)</em>}
                  </span>
                  <button className="button secondary" onClick={() => removeEntry(selectedEvent.id, entry.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}

function ProjectorModePage() {
  const params = useParams()
  const eventId = params.eventId ?? ''
  const [draw, setDraw] = useState<DrawRow | null>(null)
  const [rotation, setRotation] = useState(0)
  const [showQr, setShowQr] = useState(true)
  const [playSound, setPlaySound] = useState(false)

  useEffect(() => {
    if (!supabase || !eventId) return

    supabase
      .from('draws')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setDraw(data as DrawRow)
      })

    const channel = supabase
      .channel(`projector-${eventId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'draws', filter: `event_id=eq.${eventId}` }, (payload) => {
        setDraw(payload.new as DrawRow)
      })
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [eventId])

  useEffect(() => {
    if (!draw?.snapshot?.length || !draw.winner_entry_id) return
    const index = draw.snapshot.findIndex((entry) => entry.id === draw.winner_entry_id)
    const targetRotation = computeWheelRotation(index, draw.snapshot.length)
    setRotation(targetRotation)

    if (playSound) {
      const audio = new Audio('data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YRAAAAAA')
      void audio.play().catch(() => undefined)
    }
  }, [draw, playSound])

  const winnerName = draw?.winner_first_name ? `${draw.winner_first_name} ${draw.winner_last_name}` : 'Waiting for draw…'

  return (
    <main className="container projector">
      <header className="host-header">
        <h1>Projector Mode</h1>
        <Link to="/host">Back to host</Link>
      </header>
      <div className="row wrap">
        <label className="inline-control">
          <input type="checkbox" checked={showQr} onChange={(event) => setShowQr(event.target.checked)} /> Show QR panel
        </label>
        <label className="inline-control">
          <input type="checkbox" checked={playSound} onChange={(event) => setPlaySound(event.target.checked)} /> Play winner sound
        </label>
      </div>
      <section className="projector-grid">
        <div className="wheel-shell" aria-live="polite">
          <div className="wheel" style={{ transform: `rotate(${rotation}deg)` }}>
            <div className="wheel-center" />
          </div>
          <div className="pointer" />
        </div>
        {showQr && (
          <aside className="panel">
            <h2>Scan to join</h2>
            <p>Hosts can show QR from dashboard for accurate event link.</p>
          </aside>
        )}
      </section>
      <h2 className="winner-banner">{winnerName}</h2>
      <p>Participants in latest draw snapshot: {draw?.snapshot_size ?? 0}</p>
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
