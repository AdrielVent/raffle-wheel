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
    const rows = buildAttendanceRows('NASA Event', [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(EXCEL_HEADERS)
  })

  it('builds attendance rows including ineligible or winning entries with text types', () => {
    const rows = buildAttendanceRows('NASA Tech Expo', [
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
    expect(rows[1][0].value).toBe('NASA Tech Expo')
    expect(rows[1][1].value).toBe('Adriel')
    expect(rows[1][2].value).toBe('Ventura')
    expect(rows[1][3].value).toBe('aventura2@hofstra.edu')
    expect(rows[1][4].value).toBe('2026-11-05 12:00:00 UTC')

    // Row 2 (sanitized injection attempt and preserved ineligible attendee)
    expect(rows[2][2].value).toBe('\'=DDE("server")')
    expect(rows[2][3].value).toBe('jdoe1@hofstra.edu')
  })
})
