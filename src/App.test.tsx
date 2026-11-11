import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AttendeePage, HostDashboard, ProjectorModePage } from './App'
import * as api from './lib/api'

// Mock api
vi.mock('./lib/api', () => ({
  getPublicEvent: vi.fn(),
  submitEntry: vi.fn(),
  createEvent: vi.fn(),
  setRegistration: vi.fn(),
  endEvent: vi.fn(),
  clearEntries: vi.fn(),
  deleteEventData: vi.fn(),
  setEntryIneligible: vi.fn(),
  deleteEntryRecord: vi.fn(),
  removeEntry: vi.fn(),
  runDraw: vi.fn(),
  archiveEvent: vi.fn(),
}))

// Mock the .xlsx writer (jsdom can't save files)
vi.mock('./lib/excel', () => ({
  downloadAttendanceExcel: vi.fn().mockResolvedValue(undefined),
}))

// Mock env
vi.mock('./lib/env', () => ({
  isBackendConfigured: true,
  isLiveBackendConfigured: false,
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-anon-key',
}))

const mockEvent = {
  id: 'evt-123',
  name: 'Fall Career Mixer',
  slug: 'fall-career-mixer',
  status: 'open',
  registration_open: true,
  created_at: new Date().toISOString(),
}

function createQueryMock(arrayData: any[] = [], singleData: any = null) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data: singleData ?? arrayData[0] ?? null, error: null }),
    then: (resolve: any) => Promise.resolve({ data: arrayData, error: null }).then(resolve),
  }
  return query
}

// Mock supabase client
vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'events') {
        return createQueryMock([mockEvent], mockEvent)
      }
      if (table === 'entries') {
        return createQueryMock([], null)
      }
      if (table === 'draws') {
        return createQueryMock([], null)
      }
      return createQueryMock([], null)
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    }),
  },
}))

describe('Attendee Check-In and Dedicated Confirmation Screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.sessionStorage.setItem('raffle_host_pin_unlocked', '0828')
    // Never hit the real public relay from tests
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
  })

  it('renders check-in form with visible @hofstra.edu suffix and exact labels', async () => {
    vi.mocked(api.getPublicEvent).mockResolvedValueOnce({
      id: 'event-1',
      name: 'Fall Career Mixer',
      slug: 'fall-career-mixer',
      status: 'open',
      registration_open: true,
    })

    render(
      <MemoryRouter initialEntries={['/e/fall-career-mixer']}>
        <Routes>
          <Route path="/e/:slug" element={<AttendeePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Fall Career Mixer')).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument()
    expect(screen.getByText('Hofstra email for check-in')).toBeInTheDocument()
    expect(screen.getByText('@hofstra.edu')).toBeInTheDocument()
    expect(screen.getByText('Enter the part before @hofstra.edu.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /check in & join raffle/i })).toBeInTheDocument()
  })

  it('strips full @hofstra.edu address when pasted without duplicating suffix', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getPublicEvent).mockResolvedValueOnce({
      id: 'event-1',
      name: 'Fall Career Mixer',
      slug: 'fall-career-mixer',
      status: 'open',
      registration_open: true,
    })

    render(
      <MemoryRouter initialEntries={['/e/fall-career-mixer']}>
        <Routes>
          <Route path="/e/:slug" element={<AttendeePage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('Fall Career Mixer')
    const usernameInput = screen.getByPlaceholderText('aventura2')
    await user.type(usernameInput, 'aventura2@hofstra.edu')

    expect(usernameInput).toHaveValue('aventura2')
  })

  it('replaces form with dedicated confirmation screen on server confirmation with exact required wording', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getPublicEvent).mockResolvedValueOnce({
      id: 'event-1',
      name: 'Fall Career Mixer',
      slug: 'fall-career-mixer',
      status: 'open',
      registration_open: true,
    })
    vi.mocked(api.submitEntry).mockResolvedValueOnce({
      status: 'accepted',
      receipt_id: 'receipt-uuid-456',
    })

    render(
      <MemoryRouter initialEntries={['/e/fall-career-mixer']}>
        <Routes>
          <Route path="/e/:slug" element={<AttendeePage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('Fall Career Mixer')

    await user.type(screen.getByLabelText(/first name/i), 'Adriel')
    await user.type(screen.getByLabelText(/last name/i), 'Ventura')
    await user.type(screen.getByPlaceholderText('aventura2'), 'aventura2')

    await user.click(screen.getByRole('button', { name: /check in & join raffle/i }))

    // Form must be REPLACED with dedicated confirmation screen
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Thank you for attending Fall Career Mixer!',
      )
    })

    // Focus must move to the confirmation heading
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))

    // Exact required wording:
    expect(
      screen.getByText(/you’re checked in, adriel, and entered into the raffle\./i),
    ).toBeInTheDocument()
    expect(screen.getByText('Watch the main screen for the drawing.')).toBeInTheDocument()
    expect(screen.getByText('You can close this page.')).toBeInTheDocument()
    expect(screen.getByText('Fall Career Mixer')).toBeInTheDocument()

    // Form controls and emails must NOT be displayed on confirmation screen
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()
    expect(screen.queryByText('aventura2@hofstra.edu')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check in/i })).not.toBeInTheDocument()
  })

  it('does not show confirmation screen on duplicate email and preserves entered fields', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getPublicEvent).mockResolvedValueOnce({
      id: 'event-1',
      name: 'Fall Career Mixer',
      slug: 'fall-career-mixer',
      status: 'open',
      registration_open: true,
    })
    vi.mocked(api.submitEntry).mockResolvedValueOnce({
      status: 'already_checked_in',
    })

    render(
      <MemoryRouter initialEntries={['/e/fall-career-mixer']}>
        <Routes>
          <Route path="/e/:slug" element={<AttendeePage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('Fall Career Mixer')

    const firstInput = screen.getByLabelText(/first name/i)
    const lastInput = screen.getByLabelText(/last name/i)
    const emailInput = screen.getByPlaceholderText('aventura2')

    await user.type(firstInput, 'Adriel')
    await user.type(lastInput, 'Ventura')
    await user.type(emailInput, 'aventura2')

    await user.click(screen.getByRole('button', { name: /check in & join raffle/i }))

    // Error must be displayed
    expect(
      await screen.findByText('This Hofstra email is already checked in for this event.'),
    ).toBeInTheDocument()

    // Form must remain visible with entered inputs preserved
    expect(firstInput).toHaveValue('Adriel')
    expect(lastInput).toHaveValue('Ventura')
    expect(emailInput).toHaveValue('aventura2')

    // Confirmation screen must NOT be displayed
    expect(screen.queryByText('Thank you for attending Fall Career Mixer!')).not.toBeInTheDocument()
  })
})

describe('Host Dashboard and Projector Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.setItem('raffle_host_pin_unlocked', '0828')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
  })

  it('renders Download Excel action in host dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/host']}>
        <Routes>
          <Route path="/host" element={<HostDashboard />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Host Dashboard')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create event/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete all/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /download excel/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('renders Projector Mode with real QR panel and without attendee emails', async () => {
    render(
      <MemoryRouter initialEntries={['/host/projector/evt-123']}>
        <Routes>
          <Route path="/host/projector/:eventId" element={<ProjectorModePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Scan to Join')).toBeInTheDocument()
    expect(screen.getByText('Winner')).toBeInTheDocument()
    expect(screen.getByText('Waiting for drawing…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()

    // No emails should be displayed in Projector Mode
    expect(screen.queryAllByText(/@hofstra\.edu/)).toHaveLength(0)
  })

  it('requires Host PIN 0828 to access Host Dashboard and rejects incorrect PIN', async () => {
    window.sessionStorage.clear()
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/host']}>
        <Routes>
          <Route path="/host" element={<HostDashboard />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Host Access')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('••••')).toBeInTheDocument()

    // Test incorrect PIN
    const pinInput = screen.getByPlaceholderText('••••')
    await user.type(pinInput, '1234')
    await user.click(screen.getByRole('button', { name: /unlock dashboard/i }))

    expect(await screen.findByText(/incorrect pin/i)).toBeInTheDocument()
    expect(screen.queryByText('Host Controls')).not.toBeInTheDocument()

    // Test correct PIN 0828
    await user.clear(pinInput)
    await user.type(pinInput, '0828')
    await user.click(screen.getByRole('button', { name: /unlock dashboard/i }))

    expect(await screen.findByText('Host Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Host Authenticated')).toBeInTheDocument()
  })
})

describe('End-of-event Drive handoff, archiving, and repeat check-ins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.sessionStorage.setItem('raffle_host_pin_unlocked', '0828')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
  })

  function renderHost() {
    render(
      <MemoryRouter initialEntries={['/host']}>
        <Routes>
          <Route path="/host" element={<HostDashboard />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('downloads the Excel and opens the SHPE Events Drive folder in one click', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const excel = await import('./lib/excel')
    renderHost()

    await user.click(await screen.findByRole('button', { name: /download excel & open drive folder/i }))

    expect(openSpy).toHaveBeenCalledWith(
      'https://drive.google.com/drive/folders/1SdR0qAdPE_zqdDJJ5khZvC89KII_Nedv?usp=sharing',
      '_blank',
      'noopener',
    )
    await waitFor(() => expect(excel.downloadAttendanceExcel).toHaveBeenCalledWith('Fall Career Mixer', 'fall-career-mixer', [], new Set()))
    expect(await screen.findByText(/drag the file into the folder/i)).toBeInTheDocument()
  })

  it('archives the selected event after confirmation', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.archiveEvent).mockResolvedValue(undefined)
    renderHost()

    await user.click(await screen.findByRole('button', { name: /^archive event$/i }))

    await waitFor(() => expect(api.archiveEvent).toHaveBeenCalledWith('evt-123', true))
    expect(await screen.findByText(/was archived\. check-in is locked\./i)).toBeInTheDocument()
  })

  it('does not archive when the host cancels', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderHost()
    await user.click(await screen.findByRole('button', { name: /^archive event$/i }))
    expect(api.archiveEvent).not.toHaveBeenCalled()
  })

  it('gives a second attendee on the same phone fresh submission identifiers', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getPublicEvent).mockResolvedValue({
      id: 'event-1',
      name: 'Fall Career Mixer',
      slug: 'fall-career-mixer',
      status: 'open',
      registration_open: true,
    })
    vi.mocked(api.submitEntry).mockResolvedValue({ status: 'accepted', receipt_id: 'r' })

    render(
      <MemoryRouter initialEntries={['/e/fall-career-mixer']}>
        <Routes>
          <Route path="/e/:slug" element={<AttendeePage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Fall Career Mixer')

    async function checkIn(first: string, last: string, user1: string) {
      await user.type(screen.getByLabelText(/first name/i), first)
      await user.type(screen.getByLabelText(/last name/i), last)
      await user.type(screen.getByPlaceholderText('aventura2'), user1)
      await user.click(screen.getByRole('button', { name: /check in & join raffle/i }))
      await screen.findByRole('button', { name: /register another attendee/i })
    }

    await checkIn('Adriel', 'Ventura', 'aventura2')
    await user.click(screen.getByRole('button', { name: /register another attendee/i }))
    await checkIn('Sam', 'Chen', 'schen2')

    const calls = vi.mocked(api.submitEntry).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][4]).not.toBe(calls[1][4]) // submissionId
    expect(calls[0][5]).not.toBe(calls[1][5]) // retryReceipt
  })
})
