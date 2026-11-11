import { describe, expect, it } from 'vitest'
import {
  EXCEL_COLUMNS,
  EXCEL_HEADERS,
  buildAttendanceRows,
  formatUtcTimestamp,
  sanitizeSpreadsheetText,
} from './excel'

describe('excel attendance export utilities', () => {
  it('defines the required columns and headers', () => {
    expect(EXCEL_HEADERS.map((h) => h.value)).toEqual([
      'Event',
      'First Name',
      'Last Name',
      'Hofstra Email',
      'Check-in Time (UTC)',
    ])
    expect(EXCEL_COLUMNS).toHaveLength(5)
  })

  it('sanitizes formula injection prefixes', () => {
    expect(sanitizeSpreadsheetText('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)")
    expect(sanitizeSpreadsheetText('+12345')).toBe("'+12345")
    expect(sanitizeSpreadsheetText('-CMD')).toBe("'-CMD")
    expect(sanitizeSpreadsheetText('@dangerous')).toBe("'@dangerous")
    expect(sanitizeSpreadsheetText('Normal Text')).toBe('Normal Text')
    expect(sanitizeSpreadsheetText('')).toBe('')
    expect(sanitizeSpreadsheetText(null)).toBe('')
  })

  it('formats UTC timestamps correctly and handles invalid dates', () => {
    const formatted = formatUtcTimestamp('2026-11-05T15:30:00.000Z')
    expect(formatted).toBe('2026-11-05 15:30:00 UTC')

    expect(formatUtcTimestamp(null)).toBe('N/A')
    expect(formatUtcTimestamp('')).toBe('N/A')
    expect(formatUtcTimestamp('invalid-date')).toBe('N/A')
  })

  it('builds attendance rows for empty list with headers intact', () => {
    const rows = buildAttendanceRows('Fall Career Mixer', [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(EXCEL_HEADERS)
  })

  it('builds attendance rows including ineligible or winning entries with text types', () => {
    const rows = buildAttendanceRows('Fall Career Mixer', [
      {
        first_name: 'Adriel',
        last_name: 'Ventura',
        hofstra_email: 'aventura2@hofstra.edu',
        checked_in_at: '2026-11-05T12:00:00.000Z',
        ineligible: false,
      },
      {
        first_name: 'Jane',
        last_name: '=DDE("server")',
        hofstra_email: 'jdoe1@hofstra.edu',
        checked_in_at: '2026-11-05T12:05:00.000Z',
        ineligible: true, // Ineligible entries must still be exported
      },
    ])

    expect(rows).toHaveLength(3)
    // Row 1 (first entry)
    expect(rows[1][0].value).toBe('Fall Career Mixer')
    expect(rows[1][1].value).toBe('Adriel')
    expect(rows[1][2].value).toBe('Ventura')
    expect(rows[1][3].value).toBe('aventura2@hofstra.edu')
    expect(rows[1][4].value).toBe('2026-11-05 12:00:00 UTC')

    // Row 2 (sanitized injection attempt and preserved ineligible attendee)
    expect(rows[2][2].value).toBe('\'=DDE("server")')
    expect(rows[2][3].value).toBe('jdoe1@hofstra.edu')
  })
})

describe('raffle winner highlighting', () => {
  it('fills every cell of a winner’s row yellow and leaves others plain', async () => {
    const { buildAttendanceRows, buildAttendanceClipboard, WINNER_FILL } = await import('./excel')
    const entries = [
      { id: 'a', first_name: 'Dana', last_name: 'Cruz', hofstra_email: 'dcruz4@hofstra.edu', checked_in_at: '2026-11-10T18:00:00Z' },
      { id: 'b', first_name: 'Lee', last_name: 'Park', hofstra_email: 'lpark7@hofstra.edu', checked_in_at: '2026-11-10T18:01:00Z' },
    ]
    const rows = buildAttendanceRows('Fall Career Mixer', entries, new Set(['b']))
    expect(WINNER_FILL).toBe('#FFFF00')
    expect(rows[0].every((c) => !c.backgroundColor)).toBe(true) // header
    expect(rows[1].every((c) => !c.backgroundColor)).toBe(true) // Dana
    expect(rows[2].every((c) => c.backgroundColor === '#FFFF00')).toBe(true) // Lee won

    const { text, html } = buildAttendanceClipboard('Fall Career Mixer', entries, new Set(['b']))
    expect(text.split('\n')[0]).toBe('Event\tFirst Name\tLast Name\tHofstra Email\tCheck-in Time (UTC)')
    expect(html).toContain('<td style="background-color:#FFFF00">Lee</td>')
    expect(html).toContain('<td>Dana</td>')
  })

  it('escapes HTML in names for the Google Sheet copy', async () => {
    const { buildAttendanceClipboard } = await import('./excel')
    const { html } = buildAttendanceClipboard('Mixer', [{ id: 'x', first_name: '<b>Al</b>', last_name: 'O\'Neil', hofstra_email: 'a@hofstra.edu' }])
    expect(html).toContain('&lt;b&gt;Al&lt;/b&gt;')
    expect(html).not.toContain('<b>Al</b>')
  })
})
