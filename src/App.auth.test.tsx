import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HostDashboard } from './App'
import { supabase } from './lib/supabase'

// Live Supabase mode: hosts sign in with email + password inside the app, so it works
// in an iPhone Home Screen web app (magic links would open in Safari instead).
vi.mock('./lib/env', () => ({
  isBackendConfigured: true,
  isLiveBackendConfigured: true,
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-anon-key',
}))

function query(data: any[] = []) {
  const q: any = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
    then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
  }
  return q
}

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => query([])),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), unsubscribe: vi.fn() }),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}))

describe('Host sign-in with a live Supabase backend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.setItem('raffle_host_pin_unlocked', '0828')
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

  it('signs in with email and password inside the app (no email link)', async () => {
    const user = userEvent.setup()
    renderHost()
    await user.type(await screen.findByLabelText(/^email$/i), 'host@hofstra.edu')
    await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-9')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() =>
      expect(supabase!.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'host@hofstra.edu', password: 'correct-horse-9' }),
    )
    expect(screen.queryByText(/send sign-in link/i)).not.toBeInTheDocument()
  })

  it('creates a host account and explains the one-time email confirmation', async () => {
    const user = userEvent.setup()
    renderHost()
    await user.type(await screen.findByLabelText(/^email$/i), 'host@hofstra.edu')
    await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-9')
    await user.click(screen.getByRole('button', { name: /create host account/i }))
    expect(supabase!.auth.signUp).toHaveBeenCalled()
    expect(await screen.findByText(/open the confirmation email/i)).toBeInTheDocument()
  })

  it('does not use the public relay when Supabase is configured', async () => {
    renderHost()
    await screen.findByText('Host Dashboard')
    await new Promise((r) => setTimeout(r, 50))
    const relayCalls = vi.mocked(globalThis.fetch).mock.calls.filter(([u]) => String(u).includes('ntfy.sh'))
    expect(relayCalls).toHaveLength(0)
  })
})
