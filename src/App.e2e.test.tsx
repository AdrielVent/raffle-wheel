import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProjectorModePage, HostDashboard } from './App'
import { syncIncomingEntry } from './lib/cloudSync'
import { buildAttendanceRows } from './lib/excel'

describe('End-to-End Cross-Device Wheel & Excel Verification', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('updates Projector Mode wheel participants and roster when a phone checks in', async () => {
    render(
      <MemoryRouter initialEntries={['/host/projector/evt-nasa-2026']}>
        <Routes>
          <Route path="/host/projector/:eventId" element={<ProjectorModePage />} />
        </Routes>
      </MemoryRouter>,
    )

    // Wait for initial projector page mount
    expect(await screen.findByText('Scan to Join')).toBeInTheDocument()

    // Simulate phone check-in arriving over the cloud sync channel
    syncIncomingEntry({
      id: 'phone-entry-elena',
      event_id: 'evt-nasa-2026',
      first_name: 'Elena',
      last_name: 'Rostova',
      hofstra_email: 'erostova1@hofstra.edu',
      ineligible: false,
      checked_in_at: '2026-11-05T12:30:00Z',
      created_at: '2026-11-05T12:30:00Z',
    })

    // Elena must appear in the live roster and on the wheel
    await waitFor(() => {
      expect(screen.getByText('Elena Rostova')).toBeInTheDocument()
    })
  })

  it('includes cross-device checked-in attendee in Host Dashboard and Excel export rows', async () => {
    // Simulate phone check-in saved into shared storage via cloud sync
    syncIncomingEntry({
      id: 'phone-entry-adriel',
      event_id: 'evt-nasa-2026',
      first_name: 'Adriel',
      last_name: 'Ventura',
      hofstra_email: 'aventura2@hofstra.edu',
      ineligible: false,
      checked_in_at: '2026-11-05T12:35:00Z',
      created_at: '2026-11-05T12:35:00Z',
    })

    render(
      <MemoryRouter initialEntries={['/host']}>
        <Routes>
          <Route path="/host" element={<HostDashboard />} />
        </Routes>
      </MemoryRouter>,
    )

    // Verify Adriel appears in the attendance list
    await waitFor(() => {
      expect(screen.getByText('Adriel Ventura')).toBeInTheDocument()
      expect(screen.getByText('aventura2@hofstra.edu')).toBeInTheDocument()
    })

    // Verify Excel builder exports Adriel with UTC timestamp
    const raw = localStorage.getItem('raffle_mock_entries_v1')
    const entries = raw ? JSON.parse(raw) : []
    const excelRows = buildAttendanceRows('NASA Space Apps Challenge', entries)

    const adrielRow = excelRows.find((row) =>
      row.some((cell) => cell.value === 'aventura2@hofstra.edu'),
    )
    expect(adrielRow).toBeDefined()
    expect(adrielRow![1].value).toBe('Adriel')
    expect(adrielRow![2].value).toBe('Ventura')
    expect(adrielRow![4].value).toContain('UTC')
  })
})
