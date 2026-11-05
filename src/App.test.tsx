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
}))

// Mock env
vi.mock('./lib/env', () => ({
  isBackendConfigured: true,
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-anon-key',
}))

const mockEvent = {
  id: 'evt-123',
  name: 'NASA Tech Expo',
  slug: 'nasa-expo',
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
  })

  it('renders check-in form with visible @hofstra.edu suffix and exact labels', async () => {
    vi.mocked(api.getPublicEvent).mockResolvedValueOnce({
      id: 'event-1',
      name: 'NASA Tech Expo',
      slug: 'nasa-expo',
      status: 'open',
      registration_open: true,
    })

    render(
      <MemoryRouter initialEntries={['/e/nasa-expo']}>
        <Routes>
          <Route path="/e/:slug" element={<AttendeePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('NASA Tech Expo')).toBeInTheDocument()
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
      name: 'NASA Tech Expo',
      slug: 'nasa-expo',
      status: 'open',
      registration_open: true,
    })

    render(
      <MemoryRouter initialEntries={['/e/nasa-expo']}>
        <Routes>
          <Route path="/e/:slug" element={<AttendeePage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('NASA Tech Expo')
    const usernameInput = screen.getByPlaceholderText('aventura2')
    await user.type(usernameInput, 'aventura2@hofstra.edu')

    expect(usernameInput).toHaveValue('aventura2')
  })

  it('replaces form with dedicated confirmation screen on server confirmation with exact required wording', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getPublicEvent).mockResolvedValueOnce({
      id: 'event-1',
      name: 'NASA Tech Expo',
      slug: 'nasa-expo',
      status: 'open',
      registration_open: true,
    })
    vi.mocked(api.submitEntry).mockResolvedValueOnce({
      status: 'accepted',
      receipt_id: 'receipt-uuid-456',
    })

    render(
      <MemoryRouter initialEntries={['/e/nasa-expo']}>
        <Routes>
          <Route path="/e/:slug" element={<AttendeePage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('NASA Tech Expo')

    await user.type(screen.getByLabelText(/first name/i), 'Adriel')
    await user.type(screen.getByLabelText(/last name/i), 'Ventura')
    await user.type(screen.getByPlaceholderText('aventura2'), 'aventura2')

    await user.click(screen.getByRole('button', { name: /check in & join raffle/i }))

    // Form must be REPLACED with dedicated confirmation screen
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Thank you for attending the NASA event!',
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
    expect(screen.getByText('NASA Tech Expo')).toBeInTheDocument()

    // Form controls and emails must NOT be displayed on confirmation screen
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()
    expect(screen.queryByText('aventura2@hofstra.edu')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check in/i })).not.toBeInTheDocument()
  })

  it('does not show confirmation screen on duplicate email and preserves entered fields', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getPublicEvent).mockResolvedValueOnce({
      id: 'event-1',
      name: 'NASA Tech Expo',
      slug: 'nasa-expo',
      status: 'open',
      registration_open: true,
    })
    vi.mocked(api.submitEntry).mockResolvedValueOnce({
      status: 'already_checked_in',
    })

    render(
      <MemoryRouter initialEntries={['/e/nasa-expo']}>
        <Routes>
          <Route path="/e/:slug" element={<AttendeePage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('NASA Tech Expo')

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
    expect(screen.queryByText('Thank you for attending the NASA event!')).not.toBeInTheDocument()
  })
})

describe('Host Dashboard and Projector Mode', () => {
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

    // No emails should be displayed in Projector Mode
    expect(screen.queryAllByText(/@hofstra\.edu/)).toHaveLength(0)
  })
})
